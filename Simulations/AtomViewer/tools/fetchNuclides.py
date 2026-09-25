"""Regenerate Simulations/AtomViewer/nuclides.js from the IAEA LiveChart of Nuclides.

    python tools/fetchNuclides.py nuclides.js          (run from the AtomViewer folder)
    python tools/fetchNuclides.py nuclides.js gs.csv   (use a CSV already on disk)

Standard library only. nuclides.js is generated — edit this instead.

The LiveChart serves ENSDF (half-lives, decay modes, spins) merged with AME2020
(masses), one row per ground state, ~3,400 of them. Everything the page needs
about a nucleus it has actually seen comes from here; anything absent was never
observed, and the page falls back to its liquid-drop model for that.
"""

import csv, io, math, sys, urllib.request

URL = "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all"

if len(sys.argv) > 2:
    text = open(sys.argv[2], encoding="utf-8").read()
else:
    print(f"Fetching {URL}...", file=sys.stderr)
    # The API refuses the default urllib agent.
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")

rows = list(csv.DictReader(io.StringIO(text)))
print(f"{len(rows)} ground states", file=sys.stderr)

OPS = {"GT": ">", "LT": "<", "GE": ">", "LE": "<", "AP": "~"}


def num(s, sig=4):
    """Compact float: 4 significant figures, no trailing zeros, exponent when needed."""
    if s is None or s == "":
        return ""
    try:
        v = float(s)
    except ValueError:
        return ""
    if v == 0:
        return "0"
    out = f"{v:.{sig}g}"
    if "e" in out:
        m, e = out.split("e")
        out = m + "e" + str(int(e))
    return out


def percent(s):
    s = (s or "").strip()
    if not s:
        return "?"
    return num(s, 3)


extracted = ""
lines = []
for r in rows:
    z, n = int(r["z"]), int(r["n"])
    extracted = r.get("Extraction_date", extracted) or extracted

    hl = r["half_life"].strip()
    if hl == "STABLE":
        hl = "S"
    else:
        hl = num(r["half_life_sec"])

    op = OPS.get(r["operator_hl"].strip(), "")

    modes = []
    for k in ("1", "2", "3"):
        m = r[f"decay_{k}"].strip()
        if m:
            modes.append(m + ":" + percent(r[f"decay_{k}_%"]))

    # Binding energy per nucleon in keV. One decimal is ~1e-5 relative, far
    # below anything a reader could see, and it keeps the file small.
    be = r["binding"].strip()
    be = f"{float(be):.1f}".rstrip("0").rstrip(".") if be else ""

    # The neutron's "radius" column is its mean-square charge radius (fm^2,
    # negative). Nothing here wants it.
    rad = num(r["radius"]) if z > 0 else ""

    fields = [
        str(z), str(n), hl, op, " ".join(modes),
        num(r["abundance"], 6), be, r["jp"].strip(), rad,
        "1" if r["me_systematics"].strip() == "Y" else "",
        r["discovery"].strip(),
    ]
    lines.append("|".join(fields))

header = f"""// ============ NUCLIDE CHART — GENERATED, DO NOT EDIT ============
// Every observed nuclear ground state from the IAEA LiveChart of Nuclides
// (ENSDF decay data merged with the AME2020 mass evaluation), extracted
// {extracted}. Regenerate with:  python tools/fetchNuclides.py nuclides.js
//
// One row per nuclide, fields separated by '|':
//   Z | N | half-life in s ('S' = stable, '' = not measured) | limit (>,<,~) |
//   decay modes 'MODE:percent' space-separated ('?' = branch not measured) |
//   natural abundance % | binding energy per nucleon, keV | spin-parity |
//   charge radius, fm | 1 if the mass is extrapolated rather than measured |
//   year of discovery
"""

body = "const NUCLIDE_ROWS = `\n" + "\n".join(lines) + "\n`;\n"
result = header + "\n" + body

outpath = sys.argv[1] if len(sys.argv) > 1 else "nuclides.js"
with open(outpath, "w", encoding="utf-8", newline="\n") as f:
    f.write(result)
print(f"Wrote {outpath}: {len(lines)} rows, {len(result)} chars", file=sys.stderr)
