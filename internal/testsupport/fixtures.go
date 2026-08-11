// fixtures.go builds the two canonical fixtures: the healthy in-memory
// frontend bundle and the on-disk media delivery tree.

package testsupport

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"
)

// FrontendShellSentinel is the fixture-only text inside the canonical
// index.html. Suites assert this sentinel — never real site copy — so the
// temporary hello-world shell can grow into the real media-rich site without
// breaking a single handler-behavior test.
const FrontendShellSentinel = "naranjo-fixture-shell"

// FrontendFS returns the canonical healthy frontend bundle every suite builds
// handlers from:
//
//	index.html            the entrypoint, carrying the <html> element the
//	                      reading-mode variants are stamped onto, the
//	                      data-static-fallback structural marker, and the
//	                      FrontendShellSentinel text
//	assets/app-abc123.js  one content-hashed asset (immutable cache class)
//	favicon.svg           one root-level file (revalidated cache class)
//	downloads/blob        one extensionless file whose deliberately sniffable
//	                      HTML body pins the octet-stream unknown-type policy
//	.gitkeep              the checkout placeholder that must never be served
//
// A fresh map is returned on every call, so a test may mutate its copy
// freely without affecting any other test.
func FrontendFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(`<!doctype html><html lang="en"><main data-static-fallback><h1>` + FrontendShellSentinel + `</h1></main></html>`),
		},
		"assets/app-abc123.js": &fstest.MapFile{Data: []byte("console.log('app')")},
		"favicon.svg":          &fstest.MapFile{Data: []byte("<svg/>")},
		"downloads/blob":       &fstest.MapFile{Data: []byte("<!doctype html><script>sniffable</script>")},
		".gitkeep":             &fstest.MapFile{Data: []byte("build placeholder")},
	}
}

// MediaFileContent is the byte content of the canonical immutable clip. It is
// tiny on purpose: streaming behavior comes from an open os.File, never from
// loading production-sized data into the application.
const MediaFileContent = "0123456789"

// MediaDigest is the lowercase-hex SHA-256 of MediaFileContent. It names the
// immutable fixture directory so the fixture never models a content-addressed
// URL whose bytes violate its publication checksum. Treat it as read-only.
var MediaDigest = fmt.Sprintf("%x", sha256.Sum256([]byte(MediaFileContent)))

// MediaModTime is the fixed modification time stamped on every fixture media
// file so conditional-request assertions stay deterministic across hosts and
// runs. Treat it as read-only.
var MediaModTime = time.Unix(1_700_000_000, 0).UTC()

// ImmutableClipPath returns the public URL of the canonical immutable clip
// inside a MediaRoot tree.
func ImmutableClipPath() string {
	return "/media/immutable/" + MediaDigest + "/clip.mp4"
}

// MediaRoot writes the canonical on-disk delivery tree into a fresh temporary
// directory and returns its path:
//
//	immutable/<MediaDigest>/clip.mp4  MediaFileContent
//	mutable/song.flac                 "fLaCdata"
//	mutable/unknown.bin               "opaque"
//	mutable/album/                    an empty directory
//
// Every file carries MediaModTime. The builder needs only paths — it never
// constructs a Site or boots a server — which is what lets media-enabled
// suites in different packages share one tree shape.
func MediaRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, directory := range []string{
		filepath.Join(root, "immutable", MediaDigest),
		filepath.Join(root, "mutable"),
		filepath.Join(root, "mutable", "album"),
	} {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			t.Fatalf("MkdirAll() error = %v", err)
		}
	}
	for name, content := range map[string]string{
		filepath.Join(root, "immutable", MediaDigest, "clip.mp4"): MediaFileContent,
		filepath.Join(root, "mutable", "song.flac"):               "fLaCdata",
		filepath.Join(root, "mutable", "unknown.bin"):             "opaque",
	} {
		if err := os.WriteFile(name, []byte(content), 0o640); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}
		if err := os.Chtimes(name, MediaModTime, MediaModTime); err != nil {
			t.Fatalf("Chtimes() error = %v", err)
		}
	}
	return root
}
