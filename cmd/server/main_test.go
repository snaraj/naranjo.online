package main

import "testing"

// TestMediaConfigurationRejectsPartialEnablement keeps the runtime aligned with
// the chart's fail-closed storage sentinel and prevents silently ignored paths.
func TestMediaConfigurationRejectsPartialEnablement(t *testing.T) {
	for name, values := range map[string][3]string{
		"unknown switch":       {"yes", "", ""},
		"root while disabled":  {"false", "/not/used", ""},
		"limit while disabled": {"", "", "2"},
		"missing root":         {"true", "", "2"},
		"missing concurrency":  {"true", "/reviewed", ""},
		"zero concurrency":     {"true", "/reviewed", "0"},
		"excess concurrency":   {"true", "/reviewed", "4097"},
		"invalid concurrency":  {"true", "/reviewed", "many"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := mediaConfiguration(values[0], values[1], values[2]); err == nil {
				t.Fatal("mediaConfiguration() unexpectedly succeeded")
			}
		})
	}
}

// TestListenPort locks the single runtime listener setting: the chart-aligned
// 8080 default, the full valid range, and loud rejection of anything a broken
// pod specification could supply.
// TestPanelsRefreshConfigurationFailsClosed pins the egress opt-in gate:
// live panel refresh stays off by default, enables only on an explicit
// "true", and any other value refuses the boot instead of guessing.
func TestPanelsRefreshConfigurationFailsClosed(t *testing.T) {
	t.Parallel()
	for value, want := range map[string]bool{"": false, "false": false, "true": true} {
		enabled, err := panelsRefreshConfiguration(value)
		if err != nil || enabled != want {
			t.Errorf("panelsRefreshConfiguration(%q) = %v, %v; want %v, nil", value, enabled, err, want)
		}
	}
	for _, value := range []string{"maybe", "TRUE", "1", "yes"} {
		if _, err := panelsRefreshConfiguration(value); err == nil {
			t.Errorf("panelsRefreshConfiguration(%q) accepted an unrecognized value", value)
		}
	}
}

func TestListenPort(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		value   string
		want    int
		wantErr bool
	}{
		"empty defaults to the chart port": {value: "", want: 8080},
		"explicit port":                    {value: "9090", want: 9090},
		"lowest valid port":                {value: "1", want: 1},
		"highest valid port":               {value: "65535", want: 65535},
		"zero is refused":                  {value: "0", wantErr: true},
		"negative is refused":              {value: "-1", wantErr: true},
		"above range is refused":           {value: "65536", wantErr: true},
		"non-numeric is refused":           {value: "http", wantErr: true},
		"trailing junk is refused":         {value: "8080x", wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got, err := listenPort(testCase.value)
			if testCase.wantErr {
				if err == nil {
					t.Fatalf("listenPort(%q) = %d, want error", testCase.value, got)
				}
				return
			}
			if err != nil || got != testCase.want {
				t.Fatalf("listenPort(%q) = %d, %v, want %d, nil", testCase.value, got, err, testCase.want)
			}
		})
	}
}

// TestMediaConfigurationHasNoInventedDefaults verifies disabled startup and
// exact operator-supplied enablement without choosing Pi values in code.
func TestMediaConfigurationHasNoInventedDefaults(t *testing.T) {
	enabled, options, err := mediaConfiguration("", "", "")
	if err != nil || enabled || options.Root != "" || options.MaxConcurrent != 0 {
		t.Fatalf("disabled configuration = enabled=%t options=%+v err=%v", enabled, options, err)
	}
	enabled, options, err = mediaConfiguration("true", "/reviewed", "7")
	if err != nil || !enabled || options.Root != "/reviewed" || options.MaxConcurrent != 7 {
		t.Fatalf("enabled configuration = enabled=%t options=%+v err=%v", enabled, options, err)
	}
}
