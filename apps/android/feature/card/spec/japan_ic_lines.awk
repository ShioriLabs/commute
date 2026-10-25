# Makes impl/src/main/assets/japan_ic/lines.csv from Suica Viewer's station_codes.csv (see JAPAN_IC.md):
#
#   awk -F, -f japan_ic_lines.awk station_codes.csv > ../impl/src/main/assets/japan_ic/lines.csv
#
# One row per area and line code, in the table's order: who runs it, and its line's name when the
# code is only ever that one line (blank when it covers several). Fails if a code has two companies.
# Only the notes column, the last, is ever quoted, so the fields read here split cleanly on commas.

NR > 1 {
    key = $1 "," $2
    if (!(key in company)) {
        order[++count] = key
        company[key] = $4
        line[key] = $5
    } else {
        if (company[key] != $4) {
            print "line " key " has two companies: " company[key] ", " $4 > "/dev/stderr"
            failed = 1
            exit 1
        }
        if (line[key] != $5) line[key] = ""
    }
}

END {
    if (failed) exit 1
    print "area,line,company,line_name"
    for (i = 1; i <= count; i++) print order[i] "," company[order[i]] "," line[order[i]]
}
