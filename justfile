#!/usr/bin/env just --justfile

# print all targets
targets:
  deno run --allow-net --allow-read --allow-env --unstable cli.ts -t index.http

# display summary
summary:
  deno run --allow-net --allow-read --allow-env --unstable cli.ts --summary index.http

# invoke myip in index.http
myip:
  deno run --allow-net --allow-read --allow-env --unstable cli.ts index.http myip
