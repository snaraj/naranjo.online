// utils.go holds the strict-decoding gate shared across this package's data
// sources. It is deliberately the single admission path for panel bytes:
// SnapshotSource runs through it today, and the documented FetchSource
// contract requires the identical gate before a fetched payload may ever be
// accepted — no source gets a looser parser.

package panels

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// decodeStrict decodes one complete JSON document into v, rejecting unknown
// fields and trailing bytes. Panel data is a contract, not a suggestion: a
// field the types do not know is a schema drift to surface at construction,
// never data to silently drop.
func decodeStrict(data []byte, v any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing data after JSON document")
	}
	return nil
}

// decodeKindPayload strictly decodes raw into kind's payload type and
// returns the canonical re-marshaled bytes, so served data always has the
// typed field set and order no matter how a source spelled it. An unknown
// kind is a registry programming error and fails like any other bad payload.
func decodeKindPayload(kind string, raw json.RawMessage) (json.RawMessage, error) {
	var payload any
	switch kind {
	case KindTokenUsage:
		// The decode-only v1 mirror, deliberately: v1's admission may not
		// widen because v2 was minted beside it, and a shared struct would
		// have made a models section a KNOWN field under the old kind.
		payload = &tokenUsageDataV1{}
	case KindTokenUsageV2:
		payload = &TokenUsageData{}
	case KindVCSActivity:
		payload = &VCSActivityData{}
	case KindBossLog:
		payload = &BossLogData{}
	default:
		return nil, fmt.Errorf("unknown panel kind %q", kind)
	}
	if err := decodeStrict(raw, payload); err != nil {
		return nil, err
	}
	// Marshaling the freshly decoded package-owned payload cannot fail; the
	// canonical bytes are what the registry embeds into the envelope.
	canonical, _ := json.Marshal(payload)
	return canonical, nil
}
