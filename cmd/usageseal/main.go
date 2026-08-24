// Command usageseal is the workstation half of the panels data pipeline: it
// seals (or, for verification, opens) one payload on stdin with the shared
// internal/seal format and writes the result to stdout. The scheduled export
// job pipes the sanitized usage-series JSON through it before anything
// leaves the machine, so the series is encrypted at rest everywhere beyond
// this process.
//
// Key custody: the key is read from the file named by -key-file — a
// 64-hex-character key held at mode 0600 OUTSIDE any repository — and is
// never accepted on the command line or the environment, where it would leak
// into process listings and shell history. The tool refuses a key file that
// other users can read.
//
// Bounds: stdin is capped at maxInputBytes. The real series is a few
// kilobytes; anything approaching the cap is a mistake worth stopping.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/snaraj/naranjo.online/internal/seal"
)

// maxInputBytes bounds one payload in either direction. It comfortably holds
// every real series and stops a runaway input before it becomes a runaway
// allocation.
const maxInputBytes = 1 << 20

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

// run is the testable body of the command: parse flags, load and check the
// key, transform stdin to stdout. It returns the process exit code.
func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("usageseal", flag.ContinueOnError)
	flags.SetOutput(stderr)
	keyFile := flags.String("key-file", "", "path to the 64-hex-character key file (mode 0600, outside any repository)")
	mode := flags.String("mode", "seal", "seal (encrypt stdin) or open (decrypt stdin, for verification)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usageseal: positional arguments are not accepted; the payload arrives on stdin")
		return 2
	}
	if *mode != "seal" && *mode != "open" {
		fmt.Fprintln(stderr, "usageseal: -mode must be seal or open")
		return 2
	}
	key, err := loadKey(*keyFile)
	if err != nil {
		fmt.Fprintf(stderr, "usageseal: %v\n", err)
		return 1
	}
	input, err := readBounded(stdin)
	if err != nil {
		fmt.Fprintf(stderr, "usageseal: %v\n", err)
		return 1
	}
	var output []byte
	if *mode == "seal" {
		output, err = seal.Seal(key, input)
	} else {
		output, err = seal.Open(key, input)
	}
	if err != nil {
		fmt.Fprintf(stderr, "usageseal: %v\n", err)
		return 1
	}
	if _, err := stdout.Write(output); err != nil {
		fmt.Fprintf(stderr, "usageseal: write output: %v\n", err)
		return 1
	}
	return 0
}

// loadKey reads and parses the key file, refusing an unnamed file, a
// group/world-readable file, or malformed contents. The permission check is
// advisory hardening rather than a security boundary — the process already
// runs as the file's owner — but it catches the realistic mistake of a key
// created without a umask.
func loadKey(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New("-key-file is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("key file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("key file: not a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("key file: mode %04o is readable beyond its owner; chmod 600 it", info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("key file: %w", err)
	}
	key, err := seal.ParseKey(strings.TrimSpace(string(raw)))
	if err != nil {
		return nil, err
	}
	return key, nil
}

// readBounded reads stdin up to the cap and refuses anything past it.
func readBounded(stdin io.Reader) ([]byte, error) {
	input, err := io.ReadAll(io.LimitReader(stdin, maxInputBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read stdin: %w", err)
	}
	if len(input) > maxInputBytes {
		return nil, fmt.Errorf("stdin exceeds the %d byte bound", maxInputBytes)
	}
	return input, nil
}
