---
title: "Brotli on NGINX thread pools: ngx_mbrotli vs ngx_brotli"
description: >-
  On-the-fly Brotli blocks the NGINX event loop. ngx_mbrotli on a thread pool against
  google/ngx_brotli: p99 latency, requests per second, CPU time and memory.
date: 2026-10-22 12:50:00 +0300
projects: [ngx_mbrotli, mbrotli]
tags: [nginx, brotli, thread-pool, latency, benchmarks, performance]
summary:
  - "With google/ngx_brotli, each response is compressed inside the NGINX worker's event loop, so every other request on that worker waits. While large responses were compressed at Brotli levels 6 and 11, the p99 latency of small uncompressed requests rose from 1.9 ms to 17–514 ms."
  - "**ngx_mbrotli** with `brotli_thread_pool` compresses on NGINX thread pools. In the same test, the p99 of small requests stayed at 1.7–3.3 ms, the same as with no compression."
  - "One NGINX worker with a 4-thread pool served 3.8–15 times as many Brotli responses per second as google/ngx_brotli on 85 KB–2.2 MB files. The gain was largest at levels 9 and 11."
  - "The cost is memory. At 8 connections on 1–2.2 MB responses, a worker peaked at 138–995 MiB, 11–26 times as much as google/ngx_brotli. Responses longer than one 1 MiB segment came out 0.9–5.2% larger."
  - "Measured on 20 October 2026 with NGINX 1.30.6, one worker, an Intel Core i7-13700KF under WSL2. Every response was decoded and checked against the original by SHA-256."
faq:
  - q: Does Brotli compression block the NGINX event loop?
    a: >-
      Yes, with google/ngx_brotli and the stock gzip module. The response is compressed
      by the worker process that serves it, inside its event loop, so the worker's other
      connections wait until compression of that buffer ends. With ngx_mbrotli and
      `brotli_thread_pool`, compression runs on an NGINX thread pool and the event
      loop keeps serving other connections.
  - q: How do I compress Brotli on an NGINX thread pool?
    a: >-
      Install ngx_mbrotli, which accepts google/ngx_brotli's configuration unchanged,
      and add `brotli_thread_pool default;` next to `brotli on;`. NGINX must be built
      with `--with-threads`. To size the pool on its own, declare
      `thread_pool brotli threads=4;` in the main context and use
      `brotli_thread_pool brotli;`.
  - q: How much faster is ngx_mbrotli than google/ngx_brotli?
    a: >-
      With a 4-thread pool, one worker served 3.8–4.5 times as many requests at levels
      4–6 and 4.3–15 times as many at levels 9–11, on 85 KB–2.2 MB files. Without the
      pool, in the event loop like google/ngx_brotli, it served 5–64% more requests, and
      4.4 times as many at level 9 on an 85 KB file.
  - q: How much memory does ngx_mbrotli need on a thread pool?
    a: >-
      Much more than in the event loop. Every response being sent holds encoders for its
      segments. At 8 connections on 1–2.2 MB responses, one worker peaked at 138–995 MiB
      against 9–39 MiB for google/ngx_brotli. `brotli_parallel_tasks 1`,
      `brotli_parallel_compressors` and `brotli_retention_policy bounded <size>` keep it
      lower.
  - q: Is Brotli level 11 practical for on-the-fly compression?
    a: >-
      It is still expensive: a 2.2 MB JSON file took 785 ms of CPU time at level 11.
      On a thread pool that time no longer delays other requests. With 4 tasks, one
      response is served in 371 ms instead of 2,004 ms with google/ngx_brotli, and one
      worker served 6.4–9.6 times as many level-11 responses per second.
  - q: Why not just add more NGINX worker processes?
    a: >-
      It was not measured here. A connection stays on the worker that accepted it, so a
      request that lands on a worker busy compressing still waits for it. More workers
      make that less likely; they do not shorten the wait.
---

**ngx_mbrotli** is an NGINX module for on-the-fly Brotli compression, written in
Rust on top of the [mbrotli](https://github.com/M-Compressors/mbrotli) encoder. It
is a drop-in replacement for [google/ngx_brotli](https://github.com/google/ngx_brotli),
with the same directives, defaults and `$brotli_ratio` variable. Unlike
google/ngx_brotli, it can compress on NGINX thread pools, so that compressing a large
response does not stop the worker from serving anything else.

This post measures what that changes. One NGINX worker served large files compressed
on the fly while a second stream of small uncompressed requests went to the same
worker. With google/ngx_brotli, the 99th percentile latency of the small requests
rose from 1.9 ms to as much as 514 ms. With ngx_mbrotli on a 4-thread pool it stayed
at 1.7–3.3 ms.

<figure class="chart" id="br-latency-burst" aria-labelledby="br-latency-burst-title">
  <p class="chart-title" id="br-latency-burst-title">p99 latency of small requests while large responses are compressed</p>
  <p class="chart-sub">Large requests arrive 8 at a time. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>google/ngx_brotli</li><li><span class="key  c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key  c-pool1"></span>ngx_mbrotli, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li><li><span class="key ref"></span>no compression, 1.9 ms</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.1590"></span><span style="--x: 0.3333"></span><span style="--x: 0.4924"></span><span style="--x: 0.6667"></span><span style="--x: 0.8257"></span><span style="--x: 1.0000"></span><span class="ref" style="--x: 0.0929"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.1590">3</span><span class="tick" style="--x: 0.3333">10</span><span class="tick" style="--x: 0.4924">30</span><span class="tick" style="--x: 0.6667">100</span><span class="tick" style="--x: 0.8257">300</span><span class="tick" style="--x: 1.0000">1000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 6, react-dom.development.js (1.03 MB), 31 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6863"><i title="google/ngx_brotli: 115 ms"></i><b>115</b></span><span class="bar c-loop" style="--x: 0.6576"><i title="ngx_mbrotli, event loop: 94.0 ms"></i><b>94.0</b></span><span class="bar c-pool1" style="--x: 0.1737"><i title="ngx_mbrotli, pool, 1 task: 3.3 ms"></i><b>3.3</b></span><span class="bar c-pool4" style="--x: 0.1464"><i title="ngx_mbrotli, pool, 4 tasks: 2.8 ms"></i><b>2.8</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 11, jquery.min.js (85 KB), 7 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.9037"><i title="google/ngx_brotli: 514 ms"></i><b>514</b></span><span class="bar c-loop" style="--x: 0.8284"><i title="ngx_mbrotli, event loop: 306 ms"></i><b>306</b></span><span class="bar c-pool1" style="--x: 0.1003"><i title="ngx_mbrotli, pool, 1 task: 2.0 ms"></i><b>2.0</b></span><span class="bar c-pool4" style="--x: 0.0929"><i title="ngx_mbrotli, pool, 4 tasks: 1.9 ms"></i><b>1.9</b></span></span></div>
  </div>
  <figcaption>Small uncompressed requests (1.9 KB, 1,000 per second) on the same worker as the large compressed ones. wrk2 with coordinated omission corrected, median of three 30-second runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

The numbers come from a reduced run under WSL2 on 20 October 2026. They are good for
comparing the modules with each other, less so as absolute figures for your hardware.
[How it was measured](#how-it-was-measured) has the details and what was not
measured.

## Why compression delays other requests

An NGINX worker process serves thousands of connections from one thread. Its event
loop waits for sockets to become ready, runs a short piece of work for each one, and
goes back to waiting. That works because each piece of work is short. A filter that
runs for 100 ms holds every other connection of that worker for 100 ms.

Compression is such a filter. google/ngx_brotli and the stock gzip module compress
in the event loop. When a 1 MB JavaScript bundle is compressed at Brotli level 6,
it takes about 16 ms of CPU time, and at level 11 about 1.2 s. A small request that
arrives on the same worker meanwhile waits for compression to end. When several
large responses arrive at once, the worker compresses them back to back, and the
small request waits for all of them.

NGINX has had a way out since version 1.7.11, released on 24 March 2015 with
"experimental thread pools support" ([CHANGES](https://nginx.org/en/CHANGES)).
NGINX itself uses thread pools for blocking file I/O (`aio threads`). ngx_mbrotli
uses them for compression.

## How ngx_mbrotli compresses on a thread pool

With `brotli_thread_pool`, the module cuts a response into segments of
`brotli_parallel_segment_size`, 1 MiB by default. Each segment becomes an NGINX
thread task (`ngx_thread_task_t`) and is compressed on one of the pool's threads.
Up to `brotli_parallel_tasks` segments of one response, 4 by default, are
compressed at once. A response that fits in one segment is compressed by one
thread, in one piece.

When a task is done, its completion handler runs in the event loop. It passes the
compressed bytes down the filter chain in order and wakes the connection, as a write
event would. While tasks are in flight, the request stays marked as blocked and
buffered, so NGINX neither finalizes it early nor frees memory a thread is still
using. Meanwhile the event loop serves other connections.

Segments are compressed independently: Brotli back-references do not cross segment
boundaries. That makes segments safe to compress in parallel. It also makes a
response longer than one segment compress slightly worse, as the numbers below
show.

```nginx
load_module modules/ngx_mbrotli.so;

thread_pool brotli threads=4;

http {
    brotli on;
    brotli_comp_level 6;
    brotli_types text/plain text/css application/javascript application/json
                 image/svg+xml;

    brotli_thread_pool brotli;
}
```

NGINX must be built with `--with-threads`; `nginx -V` shows it. nginx.org's
packages are. The pool named `default` exists without being declared, with 32
threads per worker, and is shared with `aio threads`.

## How long do other requests wait?

Small uncompressed requests (`small.json`, 1.9 KB) were sent at 1,000 per second
over 32 connections. At the same time, a second stream requested large compressed
files at a constant rate of about half of what google/ngx_brotli can sustain. All
variants kept up with both streams.

<figure class="chart" id="br-latency-even" aria-labelledby="br-latency-even-title">
  <p class="chart-title" id="br-latency-even-title">p99 latency of small requests, large responses one at a time</p>
  <p class="chart-sub">Large requests arrive on one connection at a constant interval. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>google/ngx_brotli</li><li><span class="key  c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key  c-pool1"></span>ngx_mbrotli, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li><li><span class="key ref"></span>no compression, 1.9 ms</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.1590"></span><span style="--x: 0.3333"></span><span style="--x: 0.4924"></span><span style="--x: 0.6667"></span><span style="--x: 0.8257"></span><span style="--x: 1.0000"></span><span class="ref" style="--x: 0.0929"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.1590">3</span><span class="tick" style="--x: 0.3333">10</span><span class="tick" style="--x: 0.4924">30</span><span class="tick" style="--x: 0.6667">100</span><span class="tick" style="--x: 0.8257">300</span><span class="tick" style="--x: 1.0000">1000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 6, react-dom.development.js (1.03 MB), 31 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.4101"><i title="google/ngx_brotli: 17.0 ms"></i><b>17.0</b></span><span class="bar c-loop" style="--x: 0.3891"><i title="ngx_mbrotli, event loop: 14.7 ms"></i><b>14.7</b></span><span class="bar c-pool1" style="--x: 0.0768"><i title="ngx_mbrotli, pool, 1 task: 1.7 ms"></i><b>1.7</b></span><span class="bar c-pool4" style="--x: 0.0851"><i title="ngx_mbrotli, pool, 4 tasks: 1.8 ms"></i><b>1.8</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 11, jquery.min.js (85 KB), 7 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6175"><i title="google/ngx_brotli: 71.2 ms"></i><b>71.2</b></span><span class="bar c-loop" style="--x: 0.5533"><i title="ngx_mbrotli, event loop: 45.7 ms"></i><b>45.7</b></span><span class="bar c-pool1" style="--x: 0.0851"><i title="ngx_mbrotli, pool, 1 task: 1.8 ms"></i><b>1.8</b></span><span class="bar c-pool4" style="--x: 0.0929"><i title="ngx_mbrotli, pool, 4 tasks: 1.9 ms"></i><b>1.9</b></span></span></div>
  </div>
  <figcaption>The same test as the chart at the top, with one 30-second run. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Large responses | Arrival | No compression | google/ngx_brotli | ngx_mbrotli, event loop | Pool, 1 task | Pool, 4 tasks |
|---|---|--:|--:|--:|--:|--:|
| react-dom.development.js, level 6, 31 per second | 8 at once | 1.9 | 115 | 94 | 3.3 | 2.8 |
| react-dom.development.js, level 6, 31 per second | One at a time | 1.9 | 17.0 | 14.7 | 1.7 | 1.8 |
| jquery.min.js, level 11, 7 per second | 8 at once | 1.9 | 514 | 306 | 2.0 | 1.9 |
| jquery.min.js, level 11, 7 per second | One at a time | 1.9 | 71.2 | 45.7 | 1.8 | 1.9 |

</details>

"8 at once" is the large stream's 8 connections, which wrk2 starts together and which
stay in phase. It is what happens when several clients ask for large files at the same
moment. In the event loop, a small request then waits for up to 8 compressions. "One
at a time" is a single connection at a constant interval, where a small request waits
for at most one. It is the lower bound of the effect: the pool cut p99 by 9–40 times
there. On the pool, the maximum latency of a small request one at a time was 3.6 ms.

Without a thread pool, ngx_mbrotli lowers p99 by 14–41% against google/ngx_brotli,
only because mbrotli compresses faster. It blocks the event loop all the same. The
difference in tail latency comes from moving compression off the event loop, not from
a faster encoder.

## How many requests does one worker serve?

The same worker under closed-loop load, with wrk and 8 connections:

<figure class="chart" id="br-rps" aria-labelledby="br-rps-title">
  <p class="chart-title" id="br-rps-title">Requests per second, relative to google/ngx_brotli</p>
  <p class="chart-sub">8 connections. 1 task per response serves within 3% of 4, except one case. Logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key round c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key round c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li><li><span class="key ref"></span>google/ngx_brotli = 1×</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.3758"></span><span style="--x: 0.5637"></span><span style="--x: 0.7516"></span><span style="--x: 0.9395"></span><span class="ref" style="--x: 0.1879"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">0.5×</span><span class="tick" style="--x: 0.1879">1×</span><span class="tick" style="--x: 0.3758">2×</span><span class="tick" style="--x: 0.5637">4×</span><span class="tick" style="--x: 0.7516">8×</span><span class="tick" style="--x: 0.9395">16×</span></span></div>
    <p class="chart-group">jquery.min.js, 85 KB</p>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot dots"><span class="span" style="--a: 0.2263; --b: 0.5780"></span><span class="dot c-loop" style="--x: 0.2263" title="ngx_mbrotli, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5780" title="ngx_mbrotli, pool, 4 tasks: 4.2×"></span><b class="dot-value" style="--x: 0.5780">4.2×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot dots"><span class="span" style="--a: 0.2009; --b: 0.5483"></span><span class="dot c-loop" style="--x: 0.2009" title="ngx_mbrotli, event loop: 1.0×"></span><span class="dot c-pool4" style="--x: 0.5483" title="ngx_mbrotli, pool, 4 tasks: 3.8×"></span><b class="dot-value" style="--x: 0.5483">3.8×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.5875; --b: 0.9298"></span><span class="dot c-loop" style="--x: 0.5875" title="ngx_mbrotli, event loop: 4.4×"></span><span class="dot c-pool4" style="--x: 0.9298" title="ngx_mbrotli, pool, 4 tasks: 15.4×"></span><b class="dot-value" style="--x: 0.9298">15.4×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot dots"><span class="span" style="--a: 0.3215; --b: 0.6905"></span><span class="dot c-loop" style="--x: 0.3215" title="ngx_mbrotli, event loop: 1.6×"></span><span class="dot c-pool4" style="--x: 0.6905" title="ngx_mbrotli, pool, 4 tasks: 6.4×"></span><b class="dot-value" style="--x: 0.6905">6.4×</b></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot dots"><span class="span" style="--a: 0.2253; --b: 0.5512"></span><span class="dot c-loop" style="--x: 0.2253" title="ngx_mbrotli, event loop: 1.1×"></span><span class="dot c-pool4" style="--x: 0.5512" title="ngx_mbrotli, pool, 4 tasks: 3.8×"></span><b class="dot-value" style="--x: 0.5512">3.8×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot dots"><span class="span" style="--a: 0.2350; --b: 0.5872"></span><span class="dot c-loop" style="--x: 0.2350" title="ngx_mbrotli, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5872" title="ngx_mbrotli, pool, 4 tasks: 4.4×"></span><b class="dot-value" style="--x: 0.5872">4.4×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.3217; --b: 0.6356"></span><span class="dot c-loop" style="--x: 0.3217" title="ngx_mbrotli, event loop: 1.6×"></span><span class="dot c-pool4" style="--x: 0.6356" title="ngx_mbrotli, pool, 4 tasks: 5.2×"></span><b class="dot-value" style="--x: 0.6356">5.2×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot dots"><span class="span" style="--a: 0.3099; --b: 0.8007"></span><span class="dot c-loop" style="--x: 0.3099" title="ngx_mbrotli, event loop: 1.6×"></span><span class="dot c-pool4" style="--x: 0.8007" title="ngx_mbrotli, pool, 4 tasks: 9.6×"></span><b class="dot-value" style="--x: 0.8007">9.6×</b></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot dots"><span class="span" style="--a: 0.2237; --b: 0.5585"></span><span class="dot c-loop" style="--x: 0.2237" title="ngx_mbrotli, event loop: 1.1×"></span><span class="dot c-pool4" style="--x: 0.5585" title="ngx_mbrotli, pool, 4 tasks: 3.9×"></span><b class="dot-value" style="--x: 0.5585">3.9×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot dots"><span class="span" style="--a: 0.2274; --b: 0.5863"></span><span class="dot c-loop" style="--x: 0.2274" title="ngx_mbrotli, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5863" title="ngx_mbrotli, pool, 4 tasks: 4.3×"></span><b class="dot-value" style="--x: 0.5863">4.3×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.2700; --b: 0.5809"></span><span class="dot c-loop" style="--x: 0.2700" title="ngx_mbrotli, event loop: 1.4×"></span><span class="dot c-pool4" style="--x: 0.5809" title="ngx_mbrotli, pool, 4 tasks: 4.3×"></span><b class="dot-value" style="--x: 0.5809">4.3×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot dots"><span class="span" style="--a: 0.3122; --b: 0.8000"></span><span class="dot c-loop" style="--x: 0.3122" title="ngx_mbrotli, event loop: 1.6×"></span><span class="dot c-pool4" style="--x: 0.8000" title="ngx_mbrotli, pool, 4 tasks: 9.6×"></span><b class="dot-value" style="--x: 0.8000">9.6×</b></span></div>
  </div>
  <figcaption>wrk, median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | google/ngx_brotli | ngx_mbrotli, event loop | Difference | Pool, 1 task | Difference | Pool, 4 tasks | Difference |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| jquery.min.js, 85 KB | 4 | 985 | 1,135 | +15% | 4,180 | 4.2× | 4,154 | 4.2× |
| jquery.min.js, 85 KB | 6 | 674 | 706 | +5% | 2,528 | 3.8× | 2,545 | 3.8× |
| jquery.min.js, 85 KB | 9 | 108 | 472 | 4.4× | 1,655 | 15.3× | 1,669 | 15.4× |
| jquery.min.js, 85 KB | 11 | 14.9 | 24.4 | +64% | 94.5 | 6.4× | 95.0 | 6.4× |
| react-dom.development.js, 1.03 MB | 4 | 134 | 154 | +15% | 512 | 3.8× | 512 | 3.8× |
| react-dom.development.js, 1.03 MB | 6 | 63.3 | 75.3 | +19% | 282 | 4.5× | 276 | 4.4× |
| react-dom.development.js, 1.03 MB | 9 | 24.5 | 40.1 | +64% | 110 | 4.5× | 128 | 5.2× |
| react-dom.development.js, 1.03 MB | 11 | 1.02 | 1.60 | +57% | 9.76 | 9.6× | 9.78 | 9.6× |
| libraries.json, 2.2 MB | 4 | 68.4 | 78.1 | +14% | 263 | 3.8× | 268 | 3.9× |
| libraries.json, 2.2 MB | 6 | 32.7 | 37.8 | +16% | 146 | 4.5× | 142 | 4.3× |
| libraries.json, 2.2 MB | 9 | 14.8 | 20.1 | +35% | 63.3 | 4.3× | 63.3 | 4.3× |
| libraries.json, 2.2 MB | 11 | 0.55 | 0.87 | +58% | 5.11 | 9.3× | 5.26 | 9.6× |

</details>

The pool's 4 threads use the 4 CPUs that google/ngx_brotli, with one worker, cannot.
That explains about 4× at levels 4–6. The rest comes from the encoder. At level 9
the C encoder allocates a 32 MiB hash table for every response over 64 KB and frees
it afterwards. That cost does not depend on the response size, so mbrotli's lead is
largest on the 85 KB file. At level 11 a 1 MiB segment compresses faster than a whole
file, so the pool gains more than its 4 threads.

With 8 connections, 1 and 4 tasks per response served within 3% of each other, with
one exception (+17%). The pool's threads were already busy with different responses.

## How fast is one large response?

More tasks per response help when a response is longer than one segment and nothing
else competes for the threads:

<figure class="chart" id="br-single" aria-labelledby="br-single-title">
  <p class="chart-title" id="br-single-title">Time to serve one 2.2 MB response</p>
  <p class="chart-sub">libraries.json, three 1 MiB segments, one connection. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>google/ngx_brotli</li><li><span class="key  c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key  c-pool1"></span>ngx_mbrotli, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.3349"><i title="google/ngx_brotli: 14.6 ms"></i><b>14.6</b></span><span class="bar c-loop" style="--x: 0.3194"><i title="ngx_mbrotli, event loop: 12.9 ms"></i><b>12.9</b></span><span class="bar c-pool1" style="--x: 0.3213"><i title="ngx_mbrotli, pool, 1 task: 13.1 ms"></i><b>13.1</b></span><span class="bar c-pool4" style="--x: 0.2357"><i title="ngx_mbrotli, pool, 4 tasks: 6.6 ms"></i><b>6.6</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.4273"><i title="google/ngx_brotli: 30.6 ms"></i><b>30.6</b></span><span class="bar c-loop" style="--x: 0.4098"><i title="ngx_mbrotli, event loop: 26.6 ms"></i><b>26.6</b></span><span class="bar c-pool1" style="--x: 0.4030"><i title="ngx_mbrotli, pool, 1 task: 25.2 ms"></i><b>25.2</b></span><span class="bar c-pool4" style="--x: 0.3155"><i title="ngx_mbrotli, pool, 4 tasks: 12.5 ms"></i><b>12.5</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.5290"><i title="google/ngx_brotli: 69.1 ms"></i><b>69.1</b></span><span class="bar c-loop" style="--x: 0.4889"><i title="ngx_mbrotli, event loop: 50.1 ms"></i><b>50.1</b></span><span class="bar c-pool1" style="--x: 0.5003"><i title="ngx_mbrotli, pool, 1 task: 54.9 ms"></i><b>54.9</b></span><span class="bar c-pool4" style="--x: 0.3975"><i title="ngx_mbrotli, pool, 4 tasks: 24.1 ms"></i><b>24.1</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.9496"><i title="google/ngx_brotli: 2,004 ms"></i><b>2,004</b></span><span class="bar c-loop" style="--x: 0.8910"><i title="ngx_mbrotli, event loop: 1,253 ms"></i><b>1,253</b></span><span class="bar c-pool1" style="--x: 0.8303"><i title="ngx_mbrotli, pool, 1 task: 771 ms"></i><b>771</b></span><span class="bar c-pool4" style="--x: 0.7389"><i title="ngx_mbrotli, pool, 4 tasks: 371 ms"></i><b>371</b></span></span></div>
  </div>
  <figcaption>wrk, median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Level | google/ngx_brotli | ngx_mbrotli, event loop | Pool, 1 task | Pool, 4 tasks |
|--:|--:|--:|--:|--:|
| 4 | 14.6 | 12.9 | 13.1 | 6.6 |
| 6 | 30.6 | 26.6 | 25.2 | 12.5 |
| 9 | 69.1 | 50.1 | 54.9 | 24.1 |
| 11 | 2,004 | 1,253 | 771 | 371 |

</details>

4 tasks served it 2.0–2.3 times as fast as 1 task, and 2.2–5.4 times as fast as
google/ngx_brotli. Responses up to 1 MiB fit in one segment, so the number of tasks
does not change how fast they are served. `react-dom.development.js` is a 1 MiB
segment and a 31 KB one, so 4 tasks served it only 4–34% faster than 1.

## Brotli level 11 on the fly

Level 11 is usually kept for pre-compressed static files, because one response can
hold a worker for a second or more. On a thread pool, that time no longer holds up
other requests: next to a stream of level-11 responses, small requests kept a p99 of
1.8–2.0 ms. A 2.2 MB response took 371 ms with 4 tasks, against 2,004 ms with
google/ngx_brotli.

Level 11 still costs CPU. `libraries.json` needed 785 ms of CPU time per response on
the pool, and the worker served 5.3 such responses per second on 4 CPUs. It fits
responses that are large, compressible and requested rarely enough, not a busy API.

## What the thread pool costs

**Memory.** In the event loop, a worker compresses one response at a time and needs
one encoder. On a pool, every response being sent holds encoders for its segments
until it is sent. Peak memory then grows with the number of responses in flight and
with the number of tasks per response.

<figure class="chart" id="br-memory" aria-labelledby="br-memory-title">
  <p class="chart-title" id="br-memory-title">Peak memory of the worker</p>
  <p class="chart-sub">VmHWM at 8 connections, MiB, logarithmic scale. The labelled value is the pool with 4 tasks.</p>
  <ul class="chart-legend"><li><span class="key round c-stock"></span>google/ngx_brotli</li><li><span class="key round c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key round c-pool1"></span>ngx_mbrotli, pool, 1 task</li><li><span class="key round c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2222"></span><span style="--x: 0.4444"></span><span style="--x: 0.6667"></span><span style="--x: 0.8889"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">4</span><span class="tick" style="--x: 0.2222">16</span><span class="tick" style="--x: 0.4444">64</span><span class="tick" style="--x: 0.6667">256</span><span class="tick" style="--x: 0.8889">1,024</span></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot dots"><span class="span" style="--a: 0.1300; --b: 0.5676"></span><span class="dot c-stock" style="--x: 0.1300" title="google/ngx_brotli: 9 MiB"></span><span class="dot c-loop" style="--x: 0.1761" title="ngx_mbrotli, event loop: 12 MiB"></span><span class="dot c-pool1" style="--x: 0.5412" title="ngx_mbrotli, pool, 1 task: 117 MiB"></span><span class="dot c-pool4" style="--x: 0.5676" title="ngx_mbrotli, pool, 4 tasks: 138 MiB"></span><b class="dot-value" style="--x: 0.5676">138 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot dots"><span class="span" style="--a: 0.1622; --b: 0.5744"></span><span class="dot c-stock" style="--x: 0.1622" title="google/ngx_brotli: 11 MiB"></span><span class="dot c-loop" style="--x: 0.2008" title="ngx_mbrotli, event loop: 14 MiB"></span><span class="dot c-pool1" style="--x: 0.5744" title="ngx_mbrotli, pool, 1 task: 144 MiB"></span><span class="dot c-pool4" style="--x: 0.5733" title="ngx_mbrotli, pool, 4 tasks: 143 MiB"></span><b class="dot-value left" style="--x: 0.5733">143 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.3650; --b: 0.7684"></span><span class="dot c-stock" style="--x: 0.3650" title="google/ngx_brotli: 39 MiB"></span><span class="dot c-loop" style="--x: 0.3731" title="ngx_mbrotli, event loop: 41 MiB"></span><span class="dot c-pool1" style="--x: 0.7681" title="ngx_mbrotli, pool, 1 task: 482 MiB"></span><span class="dot c-pool4" style="--x: 0.7684" title="ngx_mbrotli, pool, 4 tasks: 483 MiB"></span><b class="dot-value" style="--x: 0.7684">483 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot dots"><span class="span" style="--a: 0.2938; --b: 0.6899"></span><span class="dot c-stock" style="--x: 0.2938" title="google/ngx_brotli: 25 MiB"></span><span class="dot c-loop" style="--x: 0.3119" title="ngx_mbrotli, event loop: 28 MiB"></span><span class="dot c-pool1" style="--x: 0.6899" title="ngx_mbrotli, pool, 1 task: 296 MiB"></span><span class="dot c-pool4" style="--x: 0.6746" title="ngx_mbrotli, pool, 4 tasks: 269 MiB"></span><b class="dot-value left" style="--x: 0.6746">269 MiB</b></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 4</span><span class="plot dots"><span class="span" style="--a: 0.1300; --b: 0.6387"></span><span class="dot c-stock" style="--x: 0.1300" title="google/ngx_brotli: 9 MiB"></span><span class="dot c-loop" style="--x: 0.2008" title="ngx_mbrotli, event loop: 14 MiB"></span><span class="dot c-pool1" style="--x: 0.5733" title="ngx_mbrotli, pool, 1 task: 143 MiB"></span><span class="dot c-pool4" style="--x: 0.6387" title="ngx_mbrotli, pool, 4 tasks: 215 MiB"></span><b class="dot-value" style="--x: 0.6387">215 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot dots"><span class="span" style="--a: 0.1622; --b: 0.6787"></span><span class="dot c-stock" style="--x: 0.1622" title="google/ngx_brotli: 11 MiB"></span><span class="dot c-loop" style="--x: 0.2008" title="ngx_mbrotli, event loop: 14 MiB"></span><span class="dot c-pool1" style="--x: 0.6349" title="ngx_mbrotli, pool, 1 task: 210 MiB"></span><span class="dot c-pool4" style="--x: 0.6787" title="ngx_mbrotli, pool, 4 tasks: 276 MiB"></span><b class="dot-value" style="--x: 0.6787">276 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.3650; --b: 0.8843"></span><span class="dot c-stock" style="--x: 0.3650" title="google/ngx_brotli: 39 MiB"></span><span class="dot c-loop" style="--x: 0.3807" title="ngx_mbrotli, event loop: 43 MiB"></span><span class="dot c-pool1" style="--x: 0.7800" title="ngx_mbrotli, pool, 1 task: 519 MiB"></span><span class="dot c-pool4" style="--x: 0.8843" title="ngx_mbrotli, pool, 4 tasks: 995 MiB"></span><b class="dot-value" style="--x: 0.8843">995 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot dots"><span class="span" style="--a: 0.3119; --b: 0.7756"></span><span class="dot c-stock" style="--x: 0.3119" title="google/ngx_brotli: 28 MiB"></span><span class="dot c-loop" style="--x: 0.3230" title="ngx_mbrotli, event loop: 30 MiB"></span><span class="dot c-pool1" style="--x: 0.7341" title="ngx_mbrotli, pool, 1 task: 390 MiB"></span><span class="dot c-pool4" style="--x: 0.7756" title="ngx_mbrotli, pool, 4 tasks: 505 MiB"></span><b class="dot-value" style="--x: 0.7756">505 MiB</b></span></div>
  </div>
  <figcaption>Highest of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | google/ngx_brotli | ngx_mbrotli, event loop | Pool, 1 task | Pool, 4 tasks |
|---|--:|--:|--:|--:|--:|
| react-dom.development.js, 1.03 MB | 4 | 9 | 12 | 117 | 138 |
| react-dom.development.js, 1.03 MB | 6 | 11 | 14 | 144 | 143 |
| react-dom.development.js, 1.03 MB | 9 | 39 | 41 | 482 | 483 |
| react-dom.development.js, 1.03 MB | 11 | 25 | 28 | 296 | 269 |
| libraries.json, 2.2 MB | 4 | 9 | 14 | 143 | 215 |
| libraries.json, 2.2 MB | 6 | 11 | 14 | 210 | 276 |
| libraries.json, 2.2 MB | 9 | 39 | 43 | 519 | 995 |
| libraries.json, 2.2 MB | 11 | 28 | 30 | 390 | 505 |

</details>

In the event loop, ngx_mbrotli needs 2–5 MiB more than google/ngx_brotli. On the
pool, it needs 11–26 times as much.

**CPU time.** CPU time per request, including the pool's threads, was within 0.6–1.4
times that of the event loop. At level 11 the pool needed 37–40% less, because 1 MiB
segments compress faster than a whole file. At level 9 it needed 22–40% more.

<figure class="chart" id="br-cpu" aria-labelledby="br-cpu-title">
  <p class="chart-title" id="br-cpu-title">CPU time per request</p>
  <p class="chart-sub">Worker and pool threads together, 8 connections. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>google/ngx_brotli</li><li><span class="key  c-loop"></span>ngx_mbrotli, event loop</li><li><span class="key  c-pool1"></span>ngx_mbrotli, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mbrotli, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 6</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.3463"><i title="google/ngx_brotli: 16.0 ms"></i><b>16.0</b></span><span class="bar c-loop" style="--x: 0.3241"><i title="ngx_mbrotli, event loop: 13.4 ms"></i><b>13.4</b></span><span class="bar c-pool1" style="--x: 0.3314"><i title="ngx_mbrotli, pool, 1 task: 14.2 ms"></i><b>14.2</b></span><span class="bar c-pool4" style="--x: 0.3340"><i title="ngx_mbrotli, pool, 4 tasks: 14.5 ms"></i><b>14.5</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.4677"><i title="google/ngx_brotli: 42.3 ms"></i><b>42.3</b></span><span class="bar c-loop" style="--x: 0.4050"><i title="ngx_mbrotli, event loop: 25.6 ms"></i><b>25.6</b></span><span class="bar c-pool1" style="--x: 0.4469"><i title="ngx_mbrotli, pool, 1 task: 35.8 ms"></i><b>35.8</b></span><span class="bar c-pool4" style="--x: 0.4297"><i title="ngx_mbrotli, pool, 4 tasks: 31.2 ms"></i><b>31.2</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.8806"><i title="google/ngx_brotli: 1,153 ms"></i><b>1,153</b></span><span class="bar c-loop" style="--x: 0.8173"><i title="ngx_mbrotli, event loop: 695 ms"></i><b>695</b></span><span class="bar c-pool1" style="--x: 0.7526"><i title="ngx_mbrotli, pool, 1 task: 414 ms"></i><b>414</b></span><span class="bar c-pool4" style="--x: 0.7529"><i title="ngx_mbrotli, pool, 4 tasks: 415 ms"></i><b>415</b></span></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.5331"><i title="google/ngx_brotli: 71.4 ms"></i><b>71.4</b></span><span class="bar c-loop" style="--x: 0.4913"><i title="ngx_mbrotli, event loop: 51.1 ms"></i><b>51.1</b></span><span class="bar c-pool1" style="--x: 0.5175"><i title="ngx_mbrotli, pool, 1 task: 63.0 ms"></i><b>63.0</b></span><span class="bar c-pool4" style="--x: 0.5173"><i title="ngx_mbrotli, pool, 4 tasks: 62.9 ms"></i><b>62.9</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 11</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.9738"><i title="google/ngx_brotli: 2,432 ms"></i><b>2,432</b></span><span class="bar c-loop" style="--x: 0.8913"><i title="ngx_mbrotli, event loop: 1,256 ms"></i><b>1,256</b></span><span class="bar c-pool1" style="--x: 0.8332"><i title="ngx_mbrotli, pool, 1 task: 789 ms"></i><b>789</b></span><span class="bar c-pool4" style="--x: 0.8325"><i title="ngx_mbrotli, pool, 4 tasks: 785 ms"></i><b>785</b></span></span></div>
  </div>
  <figcaption>Median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | google/ngx_brotli | ngx_mbrotli, event loop | Pool, 1 task | Pool, 4 tasks |
|---|--:|--:|--:|--:|--:|
| react-dom.development.js, 1.03 MB | 6 | 16.0 | 13.4 | 14.2 | 14.5 |
| react-dom.development.js, 1.03 MB | 9 | 42.3 | 25.6 | 35.8 | 31.2 |
| react-dom.development.js, 1.03 MB | 11 | 1,153 | 695 | 414 | 415 |
| libraries.json, 2.2 MB | 9 | 71.4 | 51.1 | 63.0 | 62.9 |
| libraries.json, 2.2 MB | 11 | 2,432 | 1,256 | 789 | 785 |

</details>

**Compression ratio.** Responses longer than one segment came out 0.9–5.2% larger,
because segments are compressed independently. Responses up to one segment are
byte-for-byte what the event loop produces.

## How to configure it

The defaults suit most sites: a 1 MiB segment and 4 tasks per response. What to
change and why:

- **Declare a pool of your own** with `thread_pool brotli threads=N;`. The
  benchmark used 4 threads on 4 CPUs. Pool sizes were not compared, so start near
  the number of CPUs a worker can use.
- **Keep `brotli_parallel_segment_size 1m`.** With `4m`, both files here fit in
  one segment, so the output is as small as in the event loop and peak memory is
  19–42% lower. At levels 4–9, it served between 9% fewer and 14% more requests per
  second than 1m. At level 11 it served 35–37% fewer, because the whole file
  compresses slower than 1 MiB segments. With 4m, only responses longer than 4 MiB
  are split across threads.
- **Lower `brotli_parallel_tasks` to save memory** when single responses are rarely
  longer than a segment. On the 2.2 MB file, 4 tasks needed up to 1.9 times the
  memory of 1. Under load, 1 and 4 tasks served about the same number of requests.
- **Bound encoder memory** with `brotli_parallel_compressors` (4 by default), which
  limits how many compressors a worker keeps encoders for, and with
  `brotli_retention_policy bounded <size>` or `release_all`, which keep less memory
  between responses.
- **Turn the pool off per location** with `brotli_thread_pool off;`.
  Compressing a small response in the event loop holds the loop only briefly. In this
  run the pool still served 1.5–5.4 times as many 1.9 KB responses per second, so
  there is no measured reason to turn it off for small responses. A size threshold
  was not measured.

The [ngx_mbrotli README](https://github.com/M-Compressors/ngx_mbrotli#configuration-directives)
documents every directive.

## When you do not need it

- **Static files** are better compressed once, at build time, at level 11, and
  served with `brotli_static on;`. Nothing is compressed per request then.
- **A CDN that compresses** for you takes the work off NGINX. Traffic between the CDN
  and NGINX may still be worth compressing.
- **Small responses only.** If no response takes long to compress, the event loop
  is never held long, and the pool mostly adds memory.

## How it was measured

**Hardware.** Intel Core i7-13700KF, Windows 10.0.26300.9711, WSL 2.7.14.0 with kernel
6.18.33.2-microsoft-standard-WSL2, Ubuntu 22.04.5. WSL2 shows 12 identical cores with
2 threads each and does not tell which are performance cores, so some of the pinned
CPUs may be efficiency cores. Traffic went over loopback without TLS, and files were
served from tmpfs (`/dev/shm`).

**Build.** NGINX 1.30.6, `./configure --with-compat --with-threads
--without-http_rewrite_module`, gcc 11.4.0, both modules dynamic.
google/ngx_brotli at commit `a71f9312` with the Brotli 1.1.0 it pins as a
submodule. ngx_mbrotli at commit `8f7508a` with mbrotli 0.5.10, built with rustc
1.99.0. This commit predates the 0.4.0 release; the current release is 0.4.5,
and the run has not been repeated on it.

**Configuration.** `worker_processes 1`, with the worker and its pool pinned to 4
physical cores, and `thread_pool cp threads=4`. On the pool, `brotli_thread_pool cp`
with `brotli_parallel_tasks 1` or the default 4. Everything else was left at its
default, including the 1m segment and encoder reuse.

**Load.** Requests per second and CPU time: wrk 4.1.0 on 4 other physical cores, 2
threads and 8 connections, 4 seconds per run (8 seconds for files over 1 MB, 5 times
as long at level 11) after a 1-second warm-up. NGINX was restarted for every run,
and each run started once the worker had been idle for 300 ms. Three runs, in an
order shuffled between runs; tables give the median. CPU time is the worker's user
and system time from `/proc/<pid>/stat`, including the pool's threads. Latency:
two wrk2 streams (commit `44a94c1`) at once, open loop, with coordinated omission
corrected; 8 at once is the median of three 30-second runs, one at a time is a single
30-second run.

**Files.** jQuery 3.7.1 (`jquery.min.js`, 85 KB) and React DOM 18.3.1
(`react-dom.development.js`, 1.03 MB) from cdnjs, the full cdnjs API listing
(`libraries.json`, 2.2 MB) and its first 10 entries (`small.json`, 1.9 KB), all
fetched on 20 October 2026.

**Correctness.** Before the runs, every response in every combination of module,
variant, level and file was decoded with curl's Brotli decoder and compared with the
original by SHA-256. All matched.

**Not measured.** gzip, more than one worker process, pool sizes other than 4
threads, a response-size threshold for the pool, HTTP/2 and HTTP/3, slow clients,
long runs and bare-metal Linux. Runs were 3 per cell and 4–40 seconds long, shorter
than a full benchmark.

## Install it

ngx_mbrotli has packages for Debian, Ubuntu, RHEL and its derivatives, and Amazon
Linux: [install it from packages](/2026/install-ngx-mbrotli-packages/), or
[build it from source](/2026/build-ngx-mbrotli-from-source/). Existing
google/ngx_brotli configuration keeps working; add `brotli_thread_pool` to move
compression off the event loop.

The same measurements for Zstandard, with ngx_mzstd against tokers/zstd-nginx-module,
are in [zstd on NGINX thread pools](/2026/ngx-mzstd-thread-pool-benchmarks/).
