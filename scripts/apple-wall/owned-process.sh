#!/usr/bin/env bash
# Stop only the exact app instance that wrote the supplied PID file.
stop_owned_process() {
  local pid_file=$1 expected_executable=$2 pid attempt command
  [[ -f $pid_file ]] || return 0
  IFS= read -r pid < "$pid_file" || true
  if [[ ! $pid =~ ^[1-9][0-9]*$ ]]; then
    echo "owned-process: ignoring invalid PID file" >&2
    return 0
  fi

  owned_executable_matches() {
    local candidate
    while IFS= read -r candidate; do
      [[ $candidate == "$expected_executable" ]] && return 0
    done < <(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p')
    return 1
  }

  owned_launch_matches() {
    command=$(ps -ww -p "$pid" -o command= 2>/dev/null) || return 1
    [[ $command == *"-PlayarrParityProcessIDFile $pid_file"* ]]
  }

  if ! owned_executable_matches || ! owned_launch_matches; then
    echo "owned-process: PID file does not identify the expected executable" >&2
    rm -f "$pid_file"
    return 0
  fi

  kill "$pid" || {
    echo "owned-process: unable to signal the recorded PID" >&2
    return 1
  }
  for attempt in {1..30}; do
    if ! owned_executable_matches || ! owned_launch_matches; then
      rm -f "$pid_file"
      return 0
    fi
    sleep 0.1
  done
  echo "owned-process: recorded process did not exit after SIGTERM" >&2
  return 1
}
