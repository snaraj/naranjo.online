// seal.go implements the three operations of the sealed format: key parsing,
// sealing (workstation side), and opening (origin side). Both halves live in
// one file so a format change is one edit reviewed once, never two halves
// drifting apart.

package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
)

// ParseKey decodes a 64-hex-character key into its 32 raw bytes. It is the
// only admission path for key material: callers hold hex strings (from a
// 0600 file on the workstation, from a Secret-fed environment variable in
// the cluster) and never raw bytes.
func ParseKey(hexKey string) ([]byte, error) {
	if len(hexKey) != KeyHexChars {
		return nil, ErrKeyFormat
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, ErrKeyFormat
	}
	return key, nil
}

// Seal encrypts plaintext under key with AES-256-GCM and a fresh random
// nonce, returning magic || nonce || ciphertext+tag. The magic is
// authenticated as associated data, binding these bytes to this format
// version.
func Seal(key, plaintext []byte) ([]byte, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	sealed := make([]byte, 0, Overhead+len(plaintext))
	sealed = append(sealed, magic...)
	sealed = append(sealed, nonce...)
	return aead.Seal(sealed, nonce, plaintext, []byte(magic)), nil
}

// Open authenticates and decrypts one sealed message. A wrong key, a flipped
// byte anywhere including the magic and nonce, or a truncated tail all fail:
// ErrSealedFormat when the bytes cannot even be this format, ErrOpen when
// they are and authentication rejects them. No partial plaintext is ever
// returned.
func Open(key, sealed []byte) ([]byte, error) {
	if len(sealed) < Overhead || string(sealed[:len(magic)]) != magic {
		return nil, ErrSealedFormat
	}
	aead, err := newAEAD(key)
	if err != nil {
		return nil, err
	}
	nonce := sealed[len(magic) : len(magic)+nonceBytes]
	plaintext, err := aead.Open(nil, nonce, sealed[len(magic)+nonceBytes:], []byte(magic))
	if err != nil {
		return nil, ErrOpen
	}
	return plaintext, nil
}

// newAEAD builds the AES-256-GCM instance for one validated key. Length is
// re-checked here so neither exported operation can run with a weaker key
// even if a caller bypasses ParseKey.
func newAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != KeyBytes {
		return nil, ErrKeyFormat
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
