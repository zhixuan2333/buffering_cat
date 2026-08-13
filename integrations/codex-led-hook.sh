#!/bin/sh

# Codex sends hook metadata as JSON on stdin. State selection is deterministic
# and costs no model tokens. The session id prevents an older/background chat
# from overwriting the LED state of the most recently active chat.
payload="$(cat)"
session_id="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null)"

controller="/Users/zhixuan/code/buffering_cat/host/target/release/buffering-cat"
state_file="/tmp/buffering-cat-led-state-$(id -u)"
owner=""
current="off"
if [ -r "$state_file" ]; then
	read -r owner current <"$state_file"
fi

set_state()
{
	owner="$session_id"
	current="$1"
	printf '%s %s\n' "$owner" "$current" >"$state_file"
	"$controller" activity "$current" >/dev/null 2>&1 || true
}

case "${1:-}" in
	idle)
		set_state idle
		;;
	thinking|working)
		set_state thinking
		;;
	complete|done)
		if [ -z "$owner" ] || [ "$owner" = "$session_id" ]; then
			set_state complete
		fi
		;;
	requires-input)
		if [ -z "$owner" ] || [ "$owner" = "$session_id" ]; then
			set_state requires-input
		fi
		;;
	post-tool)
		if [ "$owner" = "$session_id" ]; then
			if printf '%s' "$payload" | jq -e \
				'.tool_response.isError == true or .tool_response.is_error == true' \
				>/dev/null 2>&1; then
				set_state error
			elif [ "$current" = "requires-input" ]; then
				set_state thinking
			fi
		fi
		;;
	error)
		set_state error
		;;
	off|acknowledge)
		if [ -z "$owner" ] || [ "$owner" = "$session_id" ] || \
			[ "$session_id" = "manual" ]; then
			set_state off
		fi
		;;
esac

# Stop hooks require valid JSON on stdout. Empty JSON adds no model context.
printf '{}\n'
