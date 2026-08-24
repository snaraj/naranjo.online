package seal

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

// testKeyHex is a fixed test vector key — 64 hex characters, obviously
// non-secret. Production keys are generated fresh and never enter this
// repository (requirement 12).
const testKeyHex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := ParseKey(testKeyHex)
	if err != nil {
		t.Fatalf("ParseKey(test vector): %v", err)
	}
	return key
}

func TestSealThenOpenRoundTrips(t *testing.T) {
	t.Parallel()
	key := testKey(t)
	for _, plaintext := range [][]byte{
		[]byte(`{"schema":"usage-series/v1"}`),
		{},
		bytes.Repeat([]byte{0xAB}, 64<<10),
	} {
		sealed, err := Seal(key, plaintext)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}
		if len(sealed) != len(plaintext)+Overhead {
			t.Fatalf("sealed length %d, want plaintext %d + overhead %d", len(sealed), len(plaintext), Overhead)
		}
		opened, err := Open(key, sealed)
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		if !bytes.Equal(opened, plaintext) {
			t.Fatal("round trip changed the plaintext")
		}
	}
}

func TestSealDrawsAFreshNonceEveryTime(t *testing.T) {
	t.Parallel()
	key := testKey(t)
	plaintext := []byte("same input twice")
	first, err := Seal(key, plaintext)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	second, err := Seal(key, plaintext)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("two seals of one plaintext produced identical bytes: the nonce is not fresh")
	}
}

func TestOpenRefusesTheWrongKey(t *testing.T) {
	t.Parallel()
	sealed, err := Seal(testKey(t), []byte("secret series"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	otherKey, err := ParseKey(strings.Repeat("f", KeyHexChars))
	if err != nil {
		t.Fatalf("ParseKey(other): %v", err)
	}
	if _, err := Open(otherKey, sealed); !errors.Is(err, ErrOpen) {
		t.Fatalf("Open with the wrong key: got %v, want ErrOpen", err)
	}
}

// TestOpenRefusesEveryTamperedByte flips each byte of a sealed message in
// turn — magic, nonce, ciphertext, and tag alike — and requires every single
// mutation to fail. This is the AEAD integrity claim exercised exhaustively
// rather than sampled.
func TestOpenRefusesEveryTamperedByte(t *testing.T) {
	t.Parallel()
	key := testKey(t)
	sealed, err := Seal(key, []byte("integrity matters as much as confidentiality"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	for index := range sealed {
		mutated := bytes.Clone(sealed)
		mutated[index] ^= 0x01
		if _, err := Open(key, mutated); err == nil {
			t.Fatalf("flipping byte %d of %d was accepted", index, len(sealed))
		}
	}
}

func TestOpenRefusesTruncation(t *testing.T) {
	t.Parallel()
	key := testKey(t)
	sealed, err := Seal(key, []byte("a plaintext long enough to truncate meaningfully"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	for _, keep := range []int{0, 1, len(magic), Overhead - 1, Overhead, len(sealed) - 1} {
		if _, err := Open(key, sealed[:keep]); err == nil {
			t.Fatalf("truncation to %d of %d bytes was accepted", keep, len(sealed))
		}
	}
}

func TestOpenRefusesForeignBytes(t *testing.T) {
	t.Parallel()
	key := testKey(t)
	for name, input := range map[string][]byte{
		"empty":        {},
		"plain json":   []byte(`{"schema":"usage-series/v1","sources":{}}`),
		"wrong magic":  append([]byte("NOTSEAL1"), bytes.Repeat([]byte{0}, 64)...),
		"only a magic": []byte(magic),
	} {
		if _, err := Open(key, input); !errors.Is(err, ErrSealedFormat) {
			t.Fatalf("%s: got %v, want ErrSealedFormat", name, err)
		}
	}
}

func TestParseKeyRefusesMalformedKeys(t *testing.T) {
	t.Parallel()
	for name, input := range map[string]string{
		"empty":       "",
		"short":       strings.Repeat("a", KeyHexChars-1),
		"long":        strings.Repeat("a", KeyHexChars+1),
		"not hex":     strings.Repeat("g", KeyHexChars),
		"spaced":      " " + strings.Repeat("a", KeyHexChars-1),
		"half a key":  strings.Repeat("a", KeyHexChars/2),
		"uppercase G": strings.Repeat("A", KeyHexChars-1) + "G",
	} {
		if _, err := ParseKey(input); !errors.Is(err, ErrKeyFormat) {
			t.Fatalf("%s: got %v, want ErrKeyFormat", name, err)
		}
	}
}

func TestSealRefusesAWeakKeyEvenWithoutParseKey(t *testing.T) {
	t.Parallel()
	if _, err := Seal([]byte("short"), []byte("x")); !errors.Is(err, ErrKeyFormat) {
		t.Fatalf("Seal(short key): got %v, want ErrKeyFormat", err)
	}
	if _, err := Open(bytes.Repeat([]byte{1}, 16), append([]byte(magic), bytes.Repeat([]byte{0}, 28)...)); !errors.Is(err, ErrKeyFormat) {
		t.Fatalf("Open(16-byte key): got %v, want ErrKeyFormat", err)
	}
}
