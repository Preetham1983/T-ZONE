#!/bin/sh
set -e

mkdir -p /root/.config/pulse /tmp/pulse-runtime

if command -v pulseaudio >/dev/null 2>&1; then
  pulseaudio --kill >/dev/null 2>&1 || true
  if pulseaudio --start --exit-idle-time=-1 --log-target=file:/tmp/pulse.log 2>/dev/null; then
    pactl load-module module-null-sink sink_name=VirtualSink sink_properties=device.description=TZone_Virtual_Sink >/dev/null 2>&1 || true
    pactl load-module module-virtual-source source_name=VirtualMic master=VirtualSink.monitor >/dev/null 2>&1 || true
    pactl set-default-source VirtualMic >/dev/null 2>&1 || true
  fi
fi

exec "$@"
