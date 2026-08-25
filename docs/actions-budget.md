# GitHub Actions minute budget

The personal GitHub Pro account includes 3,000 GitHub-hosted Actions minutes
per billing month. The account-level Actions budget is the hard billing guard;
this repository deliberately targets 2,900–2,925 minutes instead of trying to
land on exactly 3,000.

## Scheduled baseline

`watch.yml` runs one consolidated job on a month-length-aware schedule:

- 24 hourly runs at minute 7.
- 19 additional minute-37 runs in 31-day months: 43 runs/day.
- 21 additional minute-37 runs in 30-day months: 45 runs/day.
- 24 additional minute-37 runs in February: 48 runs/day.

The consolidated `--watch` command covers watchlisted, priority, and approved
companies through direct adapters and also checks the community feeds. There
is no separate priority job or feed gate, so each tick pays for one checkout,
one dependency install, and one GitHub per-job minute round-up.

At two billed minutes per consolidated run, this uses about 2,666 watch minutes
in a 31-day month, 2,700 in a 30-day month, or 2,688 in a 28-day February. The
twice-daily Job board, weekly discovery, monthly registry check, push-triggered
watch runs, and normal duration variance consume the remaining allowance.

## Monthly recalibration

After each billing reset, use the GitHub billing report and several recent run
Usage pages to record:

1. Total account Actions minutes.
2. The 95th-percentile billed duration of the consolidated watch job.
3. Push-triggered and manually dispatched watch runs.
4. Minutes used by all other private repositories.

Calculate the next schedule with:

```text
runs/day = floor((target - fixed workflows - manual reserve) /
                 (days in billing month * p95 billed minutes per watch run))
```

Use a 2,900–2,925-minute target. Adjust the extra minute-37 hours by only one
or two runs per day at a time. If the watch job's p95 becomes three billed
minutes, reduce the schedule to roughly 29 runs per day before the next cycle.

The `$0` account-wide Actions product budget with **Stop usage when budget
limit is reached** must remain enabled. This document and the workflow schedule
are pacing controls; they are not billing enforcement.
