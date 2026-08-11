package server

import (
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// openMediaHandler validates every capability before the site becomes ready.
// Raw filesystem errors are intentionally not returned because production logs
// must not disclose local inventory or paths.
func openMediaHandler(options MediaOptions) (*mediaHandler, error) {
	if !filepath.IsAbs(options.Root) || options.MaxConcurrent < 1 || options.MaxConcurrent > MaxMediaConcurrency {
		return nil, errors.New("media configuration is incomplete")
	}
	rootInfo, err := os.Lstat(options.Root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("media root is unavailable")
	}
	root, err := os.OpenRoot(options.Root)
	if err != nil {
		return nil, errors.New("media root is unavailable")
	}
	return &mediaHandler{root: root, slots: make(chan struct{}, options.MaxConcurrent)}, nil
}

// Close releases the rooted directory descriptor after the HTTP server drains.
func (h *mediaHandler) Close() error {
	return h.root.Close()
}

// ServeHTTP validates the logical publication class, acquires one bounded
// transfer slot, opens exactly one regular file, and delegates HTTP range and
// conditional semantics to net/http without reading the file into memory.
func (h *mediaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !allowReadMethod(w, r) {
		return
	}
	name, cacheControl, etag, ok := classifyMediaPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "5")
		http.Error(w, "media capacity unavailable", http.StatusServiceUnavailable)
		return
	}

	file, info, err := h.openRegular(name)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) || errors.Is(err, errUnsafeMediaPath) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer file.Close()
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	serveModTime := info.ModTime()
	if etag == "" {
		// Mutable aliases deliberately have no metadata-only validator. Atomic
		// replacement can preserve both size and timestamp, so an ETag derived
		// from those fields could return a stale 304 forever. no-store plus a zero
		// modtime makes every mutable request retrieve the current bytes.
		serveModTime = time.Time{}
	} else {
		w.Header().Set("ETag", etag)
	}
	contentType, known := mediaTypes[strings.ToLower(path.Ext(name))]
	if !known {
		contentType = "application/octet-stream"
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(name)}))
	}
	w.Header().Set("Content-Type", contentType)
	if rangeHeader := r.Header.Get("Range"); rangeHeaderIsAbusive(rangeHeader) &&
		!preconditionsDisableRange(r, etag, serveModTime) {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", info.Size()))
		http.Error(w, "requested range not satisfiable", http.StatusRequestedRangeNotSatisfiable)
		return
	}

	deadlineWriter := &idleDeadlineWriter{ResponseWriter: w, timeout: mediaWriteIdleTimeout}
	deadlineWriter.refresh()
	http.ServeContent(deadlineWriter, r, path.Base(name), serveModTime, file)
}

// rangeHeaderIsAbusive applies the application-specific multipart bound before
// net/http allocates a range slice. Global server limits independently cap the
// complete request-header block.
func rangeHeaderIsAbusive(value string) bool {
	return len(value) > maxRangeHeaderBytes || strings.Count(value, ",") >= maxRangeParts
}

// preconditionsDisableRange mirrors the ordering relevant to ServeContent's
// Range decision. When a request will become 304/412 or a mismatched If-Range
// will force a full 200, the Range header is semantically inactive and must not
// replace that standard outcome with the application's 416 abuse response.
func preconditionsDisableRange(r *http.Request, etag string, modtime time.Time) bool {
	ifMatch := r.Header.Get("If-Match")
	if ifMatch != "" {
		if !etagListMatches(ifMatch, etag, false) {
			return true
		}
	} else if value := r.Header.Get("If-Unmodified-Since"); value != "" && !modtime.IsZero() {
		if parsed, err := http.ParseTime(value); err == nil && modtime.Truncate(time.Second).After(parsed) {
			return true
		}
	}

	ifNoneMatch := r.Header.Get("If-None-Match")
	if ifNoneMatch != "" {
		if etagListMatches(ifNoneMatch, etag, true) {
			return true
		}
	} else if value := r.Header.Get("If-Modified-Since"); value != "" && !modtime.IsZero() {
		if parsed, err := http.ParseTime(value); err == nil && !modtime.Truncate(time.Second).After(parsed) {
			return true
		}
	}

	ifRange := strings.TrimSpace(r.Header.Get("If-Range"))
	if ifRange == "" {
		return false
	}
	if strings.HasPrefix(ifRange, `"`) || strings.HasPrefix(ifRange, `W/"`) {
		return etag == "" || strings.HasPrefix(ifRange, "W/") || ifRange != etag
	}
	parsed, err := http.ParseTime(ifRange)
	return err != nil || modtime.IsZero() || parsed.Unix() != modtime.Unix()
}

// etagListMatches handles the canonical digest ETag emitted by this service.
// A wildcard matches the existing representation; weak comparison is used only
// for If-None-Match as required by HTTP conditional semantics.
func etagListMatches(value, current string, weak bool) bool {
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" {
			return true
		}
		if current == "" {
			continue
		}
		if weak {
			if strings.TrimPrefix(candidate, "W/") == strings.TrimPrefix(current, "W/") {
				return true
			}
			continue
		}
		if !strings.HasPrefix(candidate, "W/") && candidate == current {
			return true
		}
	}
	return false
}

// classifyMediaPath accepts only the two documented cache classes and returns
// the root-relative delivery path. All other namespaces are indistinguishable
// from a missing file to avoid exposing operator storage organization.
func classifyMediaPath(requestPath string) (name, cacheControl, etag string, ok bool) {
	if !strings.HasPrefix(requestPath, mediaPrefix) || strings.ContainsAny(requestPath, "\\\x00") {
		return "", "", "", false
	}
	name = strings.TrimPrefix(requestPath, mediaPrefix)
	if !fs.ValidPath(name) {
		return "", "", "", false
	}
	segments := strings.Split(name, "/")
	if len(segments) < 2 {
		return "", "", "", false
	}
	for index, segment := range segments {
		if segment == "" || strings.HasPrefix(segment, ".") || strings.HasPrefix(segment, "_") {
			return "", "", "", false
		}
		if index > 0 {
			if _, reserved := reservedMediaSegments[strings.ToLower(segment)]; reserved {
				return "", "", "", false
			}
		}
	}

	switch segments[0] {
	case "immutable":
		if len(segments) < 3 || !immutableDigest.MatchString(segments[1]) {
			return "", "", "", false
		}
		return name, immutableCacheControl, `"` + segments[1] + `"`, true
	case "mutable":
		return name, "no-store", "", true
	default:
		return "", "", "", false
	}
}

// openRegular rejects symbolic links in every path component and compares the
// opened descriptor with the final lstat result. os.Root independently prevents
// a concurrent rename or symlink swap from escaping the delivery root.
func (h *mediaHandler) openRegular(name string) (*os.File, fs.FileInfo, error) {
	segments := strings.Split(name, "/")
	current := ""
	var expected fs.FileInfo
	for index, segment := range segments {
		current = path.Join(current, segment)
		info, err := h.root.Lstat(current)
		if err != nil {
			return nil, nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, nil, errUnsafeMediaPath
		}
		if index < len(segments)-1 && !info.IsDir() {
			return nil, nil, errUnsafeMediaPath
		}
		expected = info
	}
	if expected == nil || !expected.Mode().IsRegular() {
		return nil, nil, errUnsafeMediaPath
	}

	file, err := h.root.Open(name)
	if err != nil {
		return nil, nil, err
	}
	opened, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(expected, opened) {
		file.Close()
		return nil, nil, errUnsafeMediaPath
	}
	if mediaFileHasMultipleLinks(opened) {
		// A second hard link could make an originals/staging inode reachable from
		// the derivative tree even though every visible path component is safe.
		file.Close()
		return nil, nil, errUnsafeMediaPath
	}
	return file, opened, nil
}

// Unwrap exposes the underlying writer to http.ResponseController.
func (w *idleDeadlineWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// WriteHeader refreshes the idle deadline before response metadata can block.
func (w *idleDeadlineWriter) WriteHeader(statusCode int) {
	w.refresh()
	w.ResponseWriter.WriteHeader(statusCode)
}

// Write refreshes the idle deadline for each bounded copy chunk.
func (w *idleDeadlineWriter) Write(data []byte) (int, error) {
	w.refresh()
	return w.ResponseWriter.Write(data)
}

// refresh is best-effort because in-memory test writers have no connection.
func (w *idleDeadlineWriter) refresh() {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(w.timeout))
}
