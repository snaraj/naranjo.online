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
//
// The DURABLE REPLAY FLOOR lives here too, and the 2026-08-24 round-3 review
// rebuilt it. Its state directory holds three files and every one of them is
// load-bearing:
//
//	token-usage.floor.enc    the sealed marker: the accepted capture instant
//	                         at FULL precision plus the SHA-256 of the exact
//	                         ciphertext that set it, behind a plaintext
//	                         format+key-identity header.
//	token-usage.floor.init   the tombstone: this state directory HAS been
//	                         used. Its presence turns "no marker" from a cold
//	                         start into provenance loss.
//	token-usage.floor.lock   the advisory lock every store takes, so the
//	                         load-compare-write-rename sequence is one
//	                         critical section rather than three racing ones.
package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
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
// relative to the writable STATE root (2026-08-24 review finding H2). Its
// payload is sealed under the same key as the series, so storage that can
// write the state directory still cannot forge a floor.
const panelsFloorMarkerName = "token-usage.floor.enc"

// panelsFloorTombstoneName marks a state directory that has been USED
// (2026-08-24 round-3 review, finding 4). Before it exists, an absent marker
// is a first boot and the loop starts from the embedded snapshot's instant.
// After it exists, an absent marker means a floor that was persisted has
// disappeared — provenance loss, refused rather than silently restarted at
// the embedded instant, which is exactly the rollback the review reproduced
// by deleting the marker file.
//
// It is deliberately NOT sealed. A tombstone that could only be read under
// the current key would become unreadable at the next key rotation, which is
// the trap finding 11 is about; and its only claim is "this directory has
// been used", which nothing needs a key to say. A host that can delete the
// whole state directory can still force a cold start — the tombstone bounds
// the accident and the documented ceremony, not an adversary with write
// access to state, and docs/usage-export.md says so.
const panelsFloorTombstoneName = "token-usage.floor.init"

// panelsFloorLockName is the advisory lock file guarding one store's
// load-compare-write-rename sequence (2026-08-24 round-3 review, finding 3).
const panelsFloorLockName = "token-usage.floor.lock"

// maxFloorMarkerBytes bounds one marker read. The real sealed marker is
// under two hundred bytes; anything larger is not a marker.
const maxFloorMarkerBytes = 1 << 10

// panelsFloorFormat is the marker's plaintext format header. It is bumped,
// never reinterpreted: a marker written by a different format is refused
// rather than guessed at. Version 2 added the key identity beside it and the
// accepted ciphertext digest inside it (2026-08-24 round-3 review, findings
// 2 and 11).
const panelsFloorFormat = "NJFLOOR/2"

// panelsFloorKeyIDDomain separates the key-identity fingerprint from every
// other use of the same key material, and panelsFloorKeyIDChars is how much
// of that fingerprint the header carries. The identity exists so a marker
// sealed under a PREVIOUS key is a named state ("you rotated") rather than
// an indistinguishable authentication failure ("something is broken") — see
// errFloorKeyRotated. It is a one-way fingerprint of a 256-bit random key,
// so publishing it into the state directory reveals nothing usable, and it
// is UNAUTHENTICATED by construction: it can only make a refusal more
// specific, never make an acceptance possible.
const (
	panelsFloorKeyIDDomain = "njfloor-keyid/1"
	panelsFloorKeyIDChars  = 16
)

// Floor-marker refusals. Each is a distinct operator situation with a
// distinct remedy in docs/usage-export.md, so they are distinct errors
// rather than one opaque failure.
var (
	// errFloorMarkerGone is the tombstone's whole purpose: the state
	// directory has been used, so a missing marker is loss, not a cold start.
	errFloorMarkerGone = errors.New("panels floor marker is missing from a state directory that has already been used")
	// errFloorKeyRotated reports a marker sealed under a different key. The
	// origin cannot read it and MUST NOT reset the floor on its own say-so:
	// an unauthenticated header that could lower the floor would hand back
	// exactly the rollback the tombstone above closes. The reset is an
	// explicit operator ceremony instead.
	errFloorKeyRotated = errors.New("panels floor marker was sealed under a different key; the documented reset ceremony is required")
	// errFloorNotMonotonic reports a store that would LOWER the persisted
	// floor. Two processes over one state directory made this reachable
	// (2026-08-24 round-3 review, finding 3).
	errFloorNotMonotonic = errors.New("panels floor marker refuses to record an instant below the one already persisted")
)

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
		// One classification, at boot, where an operator reads the pod log.
		// The loop itself stays silent and simply refuses; this line is what
		// turns "the panel went stale" into "you rotated the key, run the
		// reset ceremony" without anyone reading the code.
		s.panelsFloorNotice = describeFloorState(marker)
	}
	s.panelsData = root
	s.panels.StartDataRoot(ctx, root.FS(), newUnsealer(lookupEnv), marker)
	return nil
}

// PanelsFloorNotice reports the one-line operator classification of the
// durable replay floor observed at startup, or the empty string when there
// is nothing worth saying (no state root, or a healthy one). The composition
// root logs it; nothing depends on it for correctness.
func (s *Site) PanelsFloorNotice() string {
	return s.panelsFloorNotice
}

// describeFloorState classifies the persisted floor once, for the operator.
// It never changes behavior — the loop performs its own load on every tick
// and makes every decision from that.
func describeFloorState(marker *panels.FloorMarker) string {
	state, present, err := marker.Load()
	switch {
	case errors.Is(err, errFloorKeyRotated):
		return "panels replay floor: the persisted marker was sealed under a different key. " +
			"The panel will report stale until the documented reset ceremony runs " +
			"(remove the floor marker AND its init file); see docs/usage-export.md."
	case errors.Is(err, errFloorMarkerGone):
		return "panels replay floor: the state directory has been used but its marker is gone. " +
			"The panel will report stale until the documented reset ceremony runs; " +
			"see docs/usage-export.md."
	case err != nil:
		return "panels replay floor: the persisted marker exists and cannot be trusted; " +
			"the panel will report stale until it is repaired or explicitly reset."
	case !present:
		return ""
	default:
		return "panels replay floor recovered at " + state.Instant.UTC().Format(time.RFC3339Nano)
	}
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
		key, err := panelsDataKey(lookupEnv)
		if err != nil {
			return nil, err
		}
		return seal.Open(key, sealed)
	}
}

// panelsDataKey reads and parses the Secret-fed key at call time.
func panelsDataKey(lookupEnv func(string) string) ([]byte, error) {
	keyHex := strings.TrimSpace(lookupEnv(panelsDataKeyEnv))
	if keyHex == "" {
		return nil, errors.New("panels data key is not configured")
	}
	return seal.ParseKey(keyHex)
}

// floorKeyID fingerprints the key that sealed a marker. Domain-separated and
// truncated: it identifies WHICH key without being usable as one.
func floorKeyID(keyHex string) string {
	sum := sha256.Sum256([]byte(panelsFloorKeyIDDomain + keyHex))
	return hex.EncodeToString(sum[:])[:panelsFloorKeyIDChars]
}

// newFloorMarker composes the durable replay-floor marker over the writable
// state root. The marker records the instant of the last published series
// file AND the SHA-256 of the exact ciphertext that produced it, sealed
// under the SAME key as the series; the key discipline is identical to
// newUnsealer's — read from the environment at call time, held only for the
// call.
//
// What the 2026-08-24 round-3 review changed, and why each part is here:
//
//   - FULL PRECISION (finding 2). The instant was serialized with
//     time.RFC3339, which drops fractional seconds. A marker written from
//     12:00:00.900 loaded back as 12:00:00, so an authentic document at
//     12:00:00.100 — genuinely OLDER than what had already been published —
//     passed the floor after a restart. It round-trips through
//     time.RFC3339Nano now, and a test drives both directions.
//   - CIPHERTEXT BINDING (finding 2). Restart recovery has to re-admit the
//     exact file the previous process published, which meant admitting
//     equality with the floor once per restart. Bound to the instant alone,
//     that admitted any DIFFERENT authentic document sharing the instant.
//     The marker carries the accepted file's digest, and the loop admits
//     equality only when the digest matches too.
//   - MONOTONIC COMPARE-AND-SWAP UNDER A LOCK (finding 3). Two processes
//     over one state directory stored T3 then T2 and both reported success,
//     leaving the shared floor at T2. A store now takes an exclusive
//     advisory lock, re-reads the persisted floor inside it, and refuses to
//     record anything below what is already there.
//   - UNIQUE TEMPORARY FILES (finding 3). Every writer used the same
//     `.tmp` name, so concurrent writers could rename each other's bytes
//     into place. Each store writes its own O_EXCL-created temp file.
//   - DURABILITY (finding 3). write/close/rename reported success without
//     ever reaching the disk. The file is fsynced before the rename and the
//     directory is fsynced after it, so "stored" means committed — which is
//     what the publication contract spends this call to buy.
//   - THE TOMBSTONE (finding 4). See panelsFloorTombstoneName.
//   - THE KEY IDENTITY (finding 11). See panelsFloorKeyIDDomain.
//
// Load distinguishes the states the loop must tell apart. A genuinely absent
// marker in a NEVER-USED state directory is the first boot's benign cold
// state and reports (zero, false, nil). Everything else that is not a
// readable, authentic, parsable marker under the current key reports an
// error, and the loop refuses to serve on a silently lowered floor.
func newFloorMarker(state *os.Root, lookupEnv func(string) string) *panels.FloorMarker {
	return &panels.FloorMarker{
		Load: func() (panels.FloorState, bool, error) {
			return loadFloorMarker(state, lookupEnv)
		},
		Store: func(floor panels.FloorState) error {
			return storeFloorMarker(state, lookupEnv, floor)
		},
	}
}

// loadFloorMarker reads, identifies, authenticates, and parses the marker.
func loadFloorMarker(state *os.Root, lookupEnv func(string) string) (panels.FloorState, bool, error) {
	file, err := state.Open(panelsFloorMarkerName)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// Absent — but absent from WHERE? A never-used state directory
			// is a first boot and the only benign absence. A used one has
			// lost a floor it had persisted (2026-08-24 round-3 finding 4).
			used, err := floorTombstonePresent(state)
			if err != nil {
				return panels.FloorState{}, false, err
			}
			if used {
				return panels.FloorState{}, false, errFloorMarkerGone
			}
			return panels.FloorState{}, false, nil
		}
		return panels.FloorState{}, false, errors.New("panels floor marker is unreadable")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxFloorMarkerBytes+1))
	if err != nil {
		return panels.FloorState{}, false, errors.New("panels floor marker is unreadable")
	}
	if len(raw) > maxFloorMarkerBytes {
		return panels.FloorState{}, false, errors.New("panels floor marker exceeds its byte bound")
	}
	key, err := panelsDataKey(lookupEnv)
	if err != nil {
		return panels.FloorState{}, false, err
	}
	sealed, err := checkFloorHeader(raw, floorKeyID(strings.TrimSpace(lookupEnv(panelsDataKeyEnv))))
	if err != nil {
		return panels.FloorState{}, false, err
	}
	plaintext, err := seal.Open(key, sealed)
	if err != nil {
		// Deliberately not the underlying error: a wrong key, a tampered
		// byte and a truncated tail are indistinguishable by design, and
		// none of them may be served through.
		return panels.FloorState{}, false, errors.New("panels floor marker failed authentication")
	}
	floor, err := parseFloorPayload(plaintext)
	if err != nil {
		return panels.FloorState{}, false, err
	}
	return floor, true, nil
}

// checkFloorHeader splits and validates the marker's plaintext header,
// returning the sealed remainder. The header exists only to make a refusal
// SPECIFIC: nothing it says can admit anything, because the payload behind
// it still has to authenticate under the current key.
func checkFloorHeader(raw []byte, wantKeyID string) ([]byte, error) {
	newline := -1
	for index, b := range raw {
		if b == '\n' {
			newline = index
			break
		}
	}
	if newline < 0 {
		return nil, errors.New("panels floor marker carries no format header")
	}
	fields := strings.Fields(string(raw[:newline]))
	if len(fields) != 2 || fields[0] != panelsFloorFormat {
		return nil, errors.New("panels floor marker carries an unrecognized format header")
	}
	if fields[1] != wantKeyID {
		return nil, errFloorKeyRotated
	}
	return raw[newline+1:], nil
}

// parseFloorPayload decodes the sealed payload: the accepted instant at full
// precision, then the SHA-256 of the ciphertext that set it. Strict — an
// extra line, a missing line, or a malformed digest all refuse.
func parseFloorPayload(plaintext []byte) (panels.FloorState, error) {
	lines := strings.Split(strings.TrimSuffix(string(plaintext), "\n"), "\n")
	if len(lines) != 2 {
		return panels.FloorState{}, errors.New("panels floor marker does not carry an instant and a digest")
	}
	instant, err := time.Parse(time.RFC3339Nano, lines[0])
	if err != nil {
		return panels.FloorState{}, errors.New("panels floor marker does not carry an instant")
	}
	if !validFloorDigest(lines[1]) {
		return panels.FloorState{}, errors.New("panels floor marker does not carry a document digest")
	}
	return panels.FloorState{Instant: instant, Digest: lines[1]}, nil
}

// validFloorDigest admits exactly a lowercase hex SHA-256, and the LOWERCASE
// half is enforced rather than assumed. encoding/hex decodes either case, so
// the check that used to stand here admitted an uppercase spelling of a
// digest the writer can never produce — and since acceptance compares this
// string against hex.EncodeToString's lowercase output, such a marker would
// have parsed cleanly and then refused every document forever, for a reason
// nothing reported. Refusing it here says what is wrong, at the point it is
// wrong, and keeps one digest to one spelling.
func validFloorDigest(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for index := 0; index < len(value); index++ {
		char := value[index]
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

// floorTombstonePresent reports whether this state directory has ever
// recorded a floor. An unreadable tombstone is not a "no": a state directory
// that cannot answer the question fails closed.
func floorTombstonePresent(state *os.Root) (bool, error) {
	if _, err := state.Stat(panelsFloorTombstoneName); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, errors.New("panels state root cannot be read")
	}
	return true, nil
}

// storeFloorMarker is the COMMIT of one acceptance: an exclusive advisory
// lock, a monotonic compare against what is already persisted, a uniquely
// named temporary file, an fsync, an atomic rename, and an fsync of the
// directory the rename happened in. Only after all of that does it report
// success, because the caller publishes on that success.
func storeFloorMarker(state *os.Root, lookupEnv func(string) string, floor panels.FloorState) error {
	if floor.Instant.IsZero() || !validFloorDigest(floor.Digest) {
		return errors.New("panels floor marker refuses an incomplete floor")
	}
	keyHex := strings.TrimSpace(lookupEnv(panelsDataKeyEnv))
	key, err := panelsDataKey(lookupEnv)
	if err != nil {
		return err
	}

	lock, err := state.OpenFile(panelsFloorLockName, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return errors.New("panels state root is not writable")
	}
	defer lock.Close()
	unlock, err := lockExclusive(lock)
	if err != nil {
		return err
	}
	defer unlock()

	// Inside the lock, and only inside it: whatever is persisted right now
	// is what this store must not go below. A load that ERRORS refuses the
	// store outright — overwriting a marker nobody could read would be the
	// silent floor reset this whole mechanism exists to prevent.
	current, present, err := loadFloorMarker(state, lookupEnv)
	if err != nil {
		return err
	}
	if present && current.Instant.After(floor.Instant) {
		return errFloorNotMonotonic
	}

	payload := floor.Instant.UTC().Format(time.RFC3339Nano) + "\n" + floor.Digest + "\n"
	sealed, err := seal.Seal(key, []byte(payload))
	if err != nil {
		return err
	}
	document := append([]byte(panelsFloorFormat+" "+floorKeyID(keyHex)+"\n"), sealed...)

	if err := writeFloorFile(state, panelsFloorMarkerName, document); err != nil {
		return err
	}
	// The tombstone is written AFTER the first marker lands, never before: a
	// crash between the two then leaves a marker without a tombstone, which
	// the next store repairs, rather than a tombstone without a marker,
	// which would wedge a brand-new deployment into the operator ceremony.
	return ensureFloorTombstone(state)
}

// writeFloorFile writes one state file durably: a uniquely named O_EXCL
// temporary, fsync, atomic rename, then fsync of the directory so the rename
// itself survives a crash.
func writeFloorFile(state *os.Root, name string, contents []byte) error {
	temp, file, err := createFloorTemp(state, name)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			state.Remove(temp)
		}
	}()
	if _, err := file.Write(contents); err != nil {
		file.Close()
		return errors.New("panels state root write failed")
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return errors.New("panels state root could not be synced")
	}
	if err := file.Close(); err != nil {
		return errors.New("panels state root write failed")
	}
	if err := state.Rename(temp, name); err != nil {
		return errors.New("panels state root rename failed")
	}
	committed = true
	return syncFloorDirectory(state)
}

// createFloorTemp creates one uniquely named temporary file with O_EXCL, so
// two writers can never share a staging name and rename each other's bytes
// into place (2026-08-24 round-3 review, finding 3).
func createFloorTemp(state *os.Root, name string) (string, *os.File, error) {
	for attempt := 0; attempt < 8; attempt++ {
		suffix := make([]byte, 8)
		if _, err := rand.Read(suffix); err != nil {
			return "", nil, errors.New("panels state root could not name a temporary file")
		}
		temp := fmt.Sprintf("%s.%s.tmp", name, hex.EncodeToString(suffix))
		file, err := state.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			return temp, file, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", nil, errors.New("panels state root is not writable")
		}
	}
	return "", nil, errors.New("panels state root could not create a temporary file")
}

// syncFloorDirectory fsyncs the state directory itself. Without it a rename
// can be lost by a crash even though every byte of the file was synced, and
// "the floor is persisted" would be a claim about a cache.
func syncFloorDirectory(state *os.Root) error {
	directory, err := state.Open(".")
	if err != nil {
		return errors.New("panels state root could not be opened for sync")
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return errors.New("panels state root directory could not be synced")
	}
	return nil
}

// ensureFloorTombstone creates the initialized-state marker if it is absent,
// durably. Idempotent: a directory that already carries one is left alone.
func ensureFloorTombstone(state *os.Root) error {
	present, err := floorTombstonePresent(state)
	if err != nil {
		return err
	}
	if present {
		return nil
	}
	// Plain text, no secret, no instant: its whole claim is "used", and a
	// value nobody reads cannot go stale. The removal ceremony in
	// docs/usage-export.md is what makes it disappear again.
	return writeFloorFile(state, panelsFloorTombstoneName, []byte(panelsFloorFormat+" initialized\n"))
}
