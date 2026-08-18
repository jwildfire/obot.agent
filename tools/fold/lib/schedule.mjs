// The 07:00 trigger (obot.agent#204, under jwildfire/obot.roadmap#238).
//
// A CALENDAR job, not an interval. The Navigator's sweep uses StartInterval and
// its own log shows why that is not a clock: consecutive ticks drift 5, 6, 5, 5,
// 6 minutes because the interval re-arms after each run. Changing 300 to 86400
// would give "roughly daily, whenever it last finished", not 07:00.
//
// StartCalendarInterval is proven on this exact machine and account — the
// non-obot com.dough.backup agent uses it and has exited clean — so this is a
// primitive we had simply not used, not one that needs establishing.
//
// It is its own job rather than a step on the five-minute sweep. That sweep
// already fast-forwards the checkout, restarts the dashboard, and blocks up to
// two minutes spawning the admiral; a fold hung off the same cadence inherits
// that budget and its failures.
//
// RunAtLoad is deliberately absent. Installing the job is not a morning, and a
// fold that fires on install would write a boundary and a record for a window
// nobody asked about.
export const LABEL = 'com.obot.morning-fold'
export const HOUR = 7
export const MINUTE = 0

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function plist({ node, entry, pathDirs = [] }) {
  const PATH = [...pathDirs, '/usr/bin', '/bin'].join(':')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(entry)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(PATH)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${HOUR}</integer>
    <key>Minute</key><integer>${MINUTE}</integer>
  </dict>
  <key>StandardErrorPath</key><string>/tmp/${LABEL}.err</string>
  <key>StandardOutPath</key><string>/tmp/${LABEL}.out</string>
</dict>
</plist>
`
}
