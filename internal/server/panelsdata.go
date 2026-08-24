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
	"os"
	"path/filepath"
	"strings"

	"github.com/snaraj/naranjo.online/internal/seal"
)

// panelsDataKeyEnv names the environment variable carrying the
// 64-hex-character decryption key, fed from a cluster Secret.
const panelsDataKeyEnv = "PANELS_DATA_KEY"

// StartPanelData opens the panels data root and starts the panel registry's
// background re-read loop over it. The root path must be an absolute,
// non-symlink directory — the same admission the media root gets — and an
// unopenable root fails the boot loudly: a misconfigured capability is an
// operator error, unlike a missing or malformed series FILE, which the loop
// degrades on softly forever. lookupEnv supplies the key environment at
// decrypt time; the composition root passes os.Getenv.
func (s *Site) StartPanelData(ctx context.Context, rootPath string, lookupEnv func(string) string) error {
	if s.panelsData != nil {
		return errors.New("panels data root is already started")
	}
	root, err := openPanelsDataRoot(rootPath)
	if err != nil {
		return err
	}
	s.panelsData = root
	s.panels.StartDataRoot(ctx, root.FS(), newUnsealer(lookupEnv))
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
