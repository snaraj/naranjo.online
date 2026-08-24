// panelsdata.go wires the panels data root (issue #142): the composition
// root's half of the sealed usage-series pipeline. It opens the mounted
// directory as a rooted filesystem capability — os.OpenRoot, the media
// subsystem's exact fail-closed pattern — and composes the unsealer the
// panels loop authenticates files through, reading the decryption key from
// its Secret-fed environment variable AT DECRYPT TIME only, mirroring the
// panel fetcher's credential discipline: never at boot, never stored, never
// logged, never served.
//
// The capability split is deliberate: internal/panels holds no filesystem,
// key, or environment access of its own (its doctrine test pins that import
// surface), so everything it can ever read arrives through the two values
// composed here, and this file never parses a byte of the series itself.

package server

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/snaraj/naranjo.online/internal/panels"
	"github.com/snaraj/naranjo.online/internal/seal"
)

// panelsDataKeyEnv names the environment variable carrying the
// 64-hex-character decryption key, fed from a cluster Secret.
const panelsDataKeyEnv = "PANELS_DATA_KEY"

// panelsFloorMarkerName is the one file the replay-floor marker lives in,
// relative to the writable STATE root (2026-08-24 review finding H2). It is
// sealed under the same key as the series file, so storage that can write
// the state directory still cannot forge a floor.
const panelsFloorMarkerName = "token-usage.floor.enc"

// maxFloorMarkerBytes bounds one marker read. The real sealed marker is
// under a hundred bytes; anything larger is not a marker.
const maxFloorMarkerBytes = 1 << 10

// StartPanelData opens the panels data root and starts the panel registry's
// background re-read loop over it. The root path must be an absolute,
// non-symlink directory — the same admission the media root gets — and an
// unopenable root fails the boot loudly: a misconfigured capability is an
// operator error, unlike a missing or malformed series FILE, which the loop
// degrades on softly forever. statePath, when non-empty, names the writable
// directory the replay-floor marker persists in so the floor survives a
// restart (2026-08-24 review finding H2); it gets the identical fail-closed
// admission, and an empty statePath runs the loop with the process-memory
// floor only — the documented degraded mode. lookupEnv supplies the key
// environment at seal/unseal time; the composition root passes os.Getenv.
func (s *Site) StartPanelData(ctx context.Context, rootPath, statePath string, lookupEnv func(string) string) error {
	if s.panelsData != nil {
		return errors.New("panels data root is already started")
	}
	root, err := openPanelsDataRoot(rootPath)
	if err != nil {
		return err
	}
	var marker *panels.FloorMarker
	if statePath != "" {
		state, err := openPanelsDataRoot(statePath)
		if err != nil {
			root.Close()
			return err
		}
		s.panelsState = state
		marker = newFloorMarker(state, lookupEnv)
	}
	s.panelsData = root
	s.panels.StartDataRoot(ctx, root.FS(), newUnsealer(lookupEnv), marker)
	return nil
}

// openPanelsDataRoot validates and opens the directory capability. Raw
// filesystem errors are not returned, exactly as with the media root:
// production logs must not disclose local inventory or paths.
func openPanelsDataRoot(rootPath string) (*os.Root, error) {
	if !filepath.IsAbs(rootPath) {
		return nil, errors.New("panels data root must be an absolute path")
	}
	info, err := os.Lstat(rootPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("panels data root is unavailable")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, errors.New("panels data root is unavailable")
	}
	return root, nil
}

// newUnsealer composes the production unsealer: key from the environment at
// call time, then authenticated decryption through the shared seal format.
// The key material lives only for the duration of one call. Surrounding
// whitespace is trimmed before parsing, exactly as usageseal's loadKey trims
// its key FILE: the documented Secret ceremony feeds the same
// newline-terminated file `openssl rand -hex 32` writes, and the two halves
// of the pipeline must accept the identical key document or the documented
// setup decrypts on the workstation and never in the cluster.
func newUnsealer(lookupEnv func(string) string) func(sealed []byte) ([]byte, error) {
	return func(sealed []byte) ([]byte, error) {
		keyHex := strings.TrimSpace(lookupEnv(panelsDataKeyEnv))
		if keyHex == "" {
			return nil, errors.New("panels data key is not configured")
		}
		key, err := seal.ParseKey(keyHex)
		if err != nil {
			return nil, err
		}
		return seal.Open(key, sealed)
	}
}

// newFloorMarker composes the durable replay-floor marker over the writable
// state root (2026-08-24 review finding H2). The marker is the RFC3339
// instant of the last accepted series file, sealed under the SAME key as the
// series itself — the key discipline is identical to newUnsealer's: read
// from the environment at call time, held only for the call. Load fails SAFE
// on everything (absent, oversized, unauthentic, unparsable → no marker, so
// the floor stays at the embedded snapshot's — never lower), and Store is
// write-then-rename so a torn write leaves the previous marker, not a
// corrupt half.
func newFloorMarker(state *os.Root, lookupEnv func(string) string) *panels.FloorMarker {
	unseal := newUnsealer(lookupEnv)
	return &panels.FloorMarker{
		Load: func() (time.Time, bool) {
			file, err := state.Open(panelsFloorMarkerName)
			if err != nil {
				return time.Time{}, false
			}
			defer file.Close()
			sealed, err := io.ReadAll(io.LimitReader(file, maxFloorMarkerBytes+1))
			if err != nil || len(sealed) > maxFloorMarkerBytes {
				return time.Time{}, false
			}
			plaintext, err := unseal(sealed)
			if err != nil {
				return time.Time{}, false
			}
			instant, err := time.Parse(time.RFC3339, string(plaintext))
			if err != nil {
				return time.Time{}, false
			}
			return instant, true
		},
		Store: func(instant time.Time) error {
			keyHex := strings.TrimSpace(lookupEnv(panelsDataKeyEnv))
			if keyHex == "" {
				return errors.New("panels data key is not configured")
			}
			key, err := seal.ParseKey(keyHex)
			if err != nil {
				return err
			}
			sealed, err := seal.Seal(key, []byte(instant.UTC().Format(time.RFC3339)))
			if err != nil {
				return err
			}
			temp := panelsFloorMarkerName + ".tmp"
			file, err := state.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
			if err != nil {
				return errors.New("panels state root is not writable")
			}
			if _, err := file.Write(sealed); err != nil {
				file.Close()
				return errors.New("panels state root write failed")
			}
			if err := file.Close(); err != nil {
				return errors.New("panels state root write failed")
			}
			if err := state.Rename(temp, panelsFloorMarkerName); err != nil {
				return errors.New("panels state root rename failed")
			}
			return nil
		},
	}
}
