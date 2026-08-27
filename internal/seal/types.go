// Package seal is the one AEAD boundary shared by the workstation-side
// encryptor (cmd/usageseal) and the origin's panels data-root reader: both
// sides speak exactly this format, so the encrypt and decrypt halves can
// never drift apart in separate implementations.
//
// The format is deliberately minimal and versioned by its magic: an 8-byte
// magic prefix, a random 96-bit nonce, then AES-256-GCM ciphertext with its
// 128-bit tag. The magic doubles as the AEAD's associated data, so bytes
// sealed under a future format version can never open under this one even if
// the key is reused. Integrity is the point as much as confidentiality: a
// tampered, truncated, or foreign file fails authentication loudly instead
// of decoding into plausible-looking data.
//
// Standard library only (crypto/aes, crypto/cipher, crypto/rand), per
// repository requirement 9.
package seal

import "errors"

const (
	// magic identifies format version 1 and is authenticated as the AEAD's
	// associated data. A future breaking format mints a NEW magic; it never
	// reuses this one.
	magic = "NJSEAL/1"

	// KeyBytes is the AES-256 key length. Keys are supplied hex-encoded
	// (KeyHexChars characters) and parsed through ParseKey; raw key bytes
	// never appear in configuration.
	KeyBytes = 32

	// KeyHexChars is the length of the hex encoding of one key.
	KeyHexChars = KeyBytes * 2

	// nonceBytes is the standard GCM nonce size. Each Seal draws a fresh
	// random nonce; nonces are never derived or counted, so there is no
	// state to lose.
	nonceBytes = 12

	// tagBytes is the GCM authentication tag size.
	tagBytes = 16

	// Overhead is how many bytes a sealed message adds to its plaintext:
	// magic, nonce, and tag. It is also the minimum sealed size — anything
	// shorter cannot even hold an empty plaintext and is refused before any
	// cryptographic work.
	Overhead = len(magic) + nonceBytes + tagBytes

	// MaxSealedBytes is THE payload ceiling for this pipeline, in SEALED
	// bytes, and every stage enforces this one number: the exporter refuses
	// a document that would not seal within it, cmd/usageseal refuses input
	// that would not fit it, the push script refuses before opening the ssh
	// connection, the documented forced command reads one byte past it and
	// refuses before renaming over the last good file, and the origin's
	// data-root read caps at it.
	//
	// It lives here because internal/seal is the ONE boundary both halves of
	// the pipeline already share, so producer and consumer cannot drift to
	// different ceilings by editing different files. internal/panels cannot
	// import this package — its zero-egress doctrine pin holds it to a
	// stdlib-only import surface — so it restates the number and a parity
	// test names this constant on failure, the repository's standard
	// hand-duplication pin.
	//
	// The number is measured, not guessed, and the measurement was REDONE at
	// the 2026-08-24 round-3 review because the figures below had gone stale
	// against the document the producer now emits — finding 5 added a
	// required per-source capturedAt, and the complete window and derived
	// sections became mandatory rather than optional. The structural maximum
	// the origin can admit is one document covering both shipped snapshot
	// sources, each at the 732-day series bound with the complete five-key
	// category vocabulary and every required section present; compact-encoded
	// and sealed, that measures 98,958 bytes at ten-digit daily values — an
	// order of magnitude above the shipped snapshot's own measured peak day.
	// 131,072 leaves 32,114 bytes of headroom, which is three further decimal
	// digits on every value in the document: the same maximum still seals to
	// 125,340 bytes at thirteen digits and only passes the cap at fourteen,
	// where it reaches 134,134.
	//
	// The numbers are no longer transcribed into an assertion. CapParityTest
	// BUILDS that maximum document from the shipped snapshot's own labels and
	// the producer's own vocabulary and measures it, so the class of drift
	// that made this comment wrong cannot recur silently.
	//
	// A separate, tighter gate remains downstream: the merged payload must
	// still fit the panels response budget before it is served, so this
	// ceiling bounds allocation and transport, and never promises that
	// everything under it can be served.
	MaxSealedBytes = 128 << 10

	// MaxPlaintextBytes is the same ceiling expressed for the producing side:
	// the largest plaintext that still seals within MaxSealedBytes, since
	// sealing adds exactly Overhead bytes.
	MaxPlaintextBytes = MaxSealedBytes - Overhead
)

// ErrKeyFormat reports a key that is not exactly KeyHexChars hex characters.
var ErrKeyFormat = errors.New("seal: key must be exactly 64 hex characters")

// ErrSealedFormat reports sealed bytes too short or not carrying the format
// magic — a file that is not this format at all, as opposed to one that is
// and fails authentication.
var ErrSealedFormat = errors.New("seal: input does not carry the sealed format")

// ErrOpen reports sealed bytes in the right format whose authentication
// failed: a wrong key, a tampered byte, or a truncated tail. The three are
// deliberately indistinguishable — that is what an AEAD promises.
var ErrOpen = errors.New("seal: authentication failed")
