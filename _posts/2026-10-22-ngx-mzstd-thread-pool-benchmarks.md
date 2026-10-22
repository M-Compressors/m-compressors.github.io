---
title: "zstd on NGINX thread pools: ngx_mzstd vs zstd-nginx-module"
description: >-
  On-the-fly zstd blocks the NGINX event loop. ngx_mzstd on a thread pool against
  tokers/zstd-nginx-module: p99 latency, requests per second, CPU time and memory.
date: 2026-10-22 13:00:00 +0300
projects: [ngx_mzstd, mzstd]
tags: [nginx, zstd, zstandard, thread-pool, latency, benchmarks, performance]
summary:
  - "With tokers/zstd-nginx-module, zstd compression runs inside the NGINX worker's event loop. While large responses were compressed at levels 3 and 19, the p99 latency of small uncompressed requests on the same worker rose from 1.9 ms to 4.2–198 ms, and to 1.5 s when 8 large requests arrived at once."
  - "**ngx_mzstd** with `zstd_thread_pool` compresses on NGINX thread pools. In the same test, the p99 of small requests stayed at 1.7–2.0 ms, the same as with no compression."
  - "One NGINX worker with a 4-thread pool served 2.2–15 times as many zstd responses per second as tokers/zstd-nginx-module on 85 KB–2.2 MB files, the most at levels 15 and 19."
  - "With the default 1m segments, the pool used 1.4–2.1 times the CPU time per response of the event loop at levels 9–19. Two causes were measured: segment overlap and encoders allocated anew. `zstd_parallel_segment_size 4m` brought it down to 1.04–1.21 times in all but one case."
  - "Measured on 20 October 2026 with NGINX 1.30.6, one worker, an Intel Core i7-13700KF under WSL2. Every response was decoded and checked against the original by SHA-256."
faq:
  - q: Does zstd compression block the NGINX event loop?
    a: >-
      Yes, with tokers/zstd-nginx-module. The response is compressed by the worker that
      serves it, inside its event loop, so the worker's other connections wait. With
      ngx_mzstd and `zstd_thread_pool`, compression runs on an NGINX thread pool and the
      event loop keeps serving other connections.
  - q: How do I compress zstd on an NGINX thread pool?
    a: >-
      Install ngx_mzstd, which accepts tokers/zstd-nginx-module's configuration
      unchanged, and add `zstd_thread_pool default;` next to `zstd on;`. NGINX must be
      built with `--with-threads`. To size the pool on its own, declare
      `thread_pool zstd threads=4;` in the main context and use `zstd_thread_pool zstd;`.
  - q: How much faster is ngx_mzstd than tokers/zstd-nginx-module?
    a: >-
      With a 4-thread pool, one worker served 2.2–15 times as many requests on
      85 KB–2.2 MB files. Without the pool, in the event loop like
      tokers/zstd-nginx-module, it served 0.97–4.0 times as many, the most at level 15
      on an 85 KB file.
  - q: Which zstd_parallel_segment_size should I use?
    a: >-
      `4m` rather than the default `1m`. With 1m, every segment but the first re-reads
      part of the previous input, and that costs up to twice the CPU time per response.
      With 4m, responses of 1 and 2.2 MB needed 1.04–1.21 times the CPU time of the event
      loop in all but one case, a worker served 15–69% more requests, and the output was as small as without
      the pool. Only responses longer than 4 MiB are then split across threads.
  - q: How much memory does ngx_mzstd need on a thread pool?
    a: >-
      Much more than in the event loop. At 8 connections on 1–2.2 MB responses, one
      worker peaked at 52–1,119 MiB, 6–18 times as much as tokers/zstd-nginx-module. In
      the event loop its memory is close to tokers/zstd-nginx-module's, and lower at
      levels 15 and 19.
  - q: Does ngx_mzstd need libzstd?
    a: >-
      No. It is built on mzstd, a Zstandard implementation in safe Rust whose
      single-threaded output is byte-identical to zstd 1.5.7.
---

**ngx_mzstd** is an NGINX module for on-the-fly Zstandard (zstd) compression,
written in Rust on top of the [mzstd](https://github.com/M-Compressors/mzstd)
encoder. It is a drop-in replacement for
[tokers/zstd-nginx-module](https://github.com/tokers/zstd-nginx-module), with the
same directives, and needs no libzstd. Unlike tokers/zstd-nginx-module, it can
compress on NGINX thread pools, so that compressing a large response does not stop
the worker from serving anything else.

This post measures what that changes, and what it costs. One NGINX worker served
large files compressed on the fly while a stream of small uncompressed requests went
to the same worker. With tokers/zstd-nginx-module at level 19, the 99th percentile
latency of the small requests rose from 1.9 ms to 198 ms, and to 1.5 s when 8 large
requests arrived together. With ngx_mzstd on a 4-thread pool it stayed at 1.7–2.0 ms.

<figure class="chart" id="zstd-latency-burst" aria-labelledby="zstd-latency-burst-title">
  <p class="chart-title" id="zstd-latency-burst-title">p99 latency of small requests while large responses are compressed</p>
  <p class="chart-sub">Large requests arrive 8 at a time. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>tokers/zstd-nginx-module</li><li><span class="key  c-loop"></span>ngx_mzstd, event loop</li><li><span class="key  c-pool1"></span>ngx_mzstd, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mzstd, pool, 4 tasks</li><li><span class="key ref"></span>no compression, 1.9 ms</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span><span class="ref" style="--x: 0.0802"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 3, react-dom.development.js (1.03 MB), 178 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.2739"><i title="tokers/zstd-nginx-module: 9.0 ms"></i><b>9.0</b></span><span class="bar c-loop" style="--x: 0.2414"><i title="ngx_mzstd, event loop: 6.9 ms"></i><b>6.9</b></span><span class="bar c-pool1" style="--x: 0.0685"><i title="ngx_mzstd, pool, 1 task: 1.7 ms"></i><b>1.7</b></span><span class="bar c-pool4" style="--x: 0.0755"><i title="ngx_mzstd, pool, 4 tasks: 1.8 ms"></i><b>1.8</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 19, react-dom.development.js (1.03 MB), 2 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.9159"><i title="tokers/zstd-nginx-module: 1,530 ms"></i><b>1,530</b></span><span class="bar c-loop" style="--x: 0.8856"><i title="ngx_mzstd, event loop: 1,200 ms"></i><b>1,200</b></span><span class="bar c-pool1" style="--x: 0.0834"><i title="ngx_mzstd, pool, 1 task: 1.9 ms"></i><b>1.9</b></span><span class="bar c-pool4" style="--x: 0.0847"><i title="ngx_mzstd, pool, 4 tasks: 2.0 ms"></i><b>2.0</b></span></span></div>
  </div>
  <figcaption>Small uncompressed requests (1.9 KB, 1,000 per second) on the same worker as the large compressed ones. wrk2 with coordinated omission corrected, median of three 30-second runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

The numbers come from a reduced run under WSL2 on 20 October 2026. They are good for
comparing the modules with each other, less so as absolute figures for your hardware.
[How it was measured](#how-it-was-measured) has the details and what was not
measured.

## Why compression delays other requests

An NGINX worker process serves all of its connections from one thread, in an event
loop that runs a short piece of work for each ready socket. A filter that runs for
200 ms holds every other connection of that worker for 200 ms.

tokers/zstd-nginx-module compresses in the event loop, as the stock gzip module
does. zstd at level 3 is fast: 2.8 ms of CPU time for a 1 MB JavaScript bundle. At
level 19 the same file takes about 200 ms. A small request that arrives on that
worker meanwhile waits for compression to end. When 8 large requests arrive together,
the worker compresses them one after another, and the small request waits about
8 × 200 ms.

NGINX has had thread pools since version 1.7.11, released on 24 March 2015
([CHANGES](https://nginx.org/en/CHANGES)), and uses them for blocking file I/O
(`aio threads`). ngx_mzstd uses them for compression.

## How ngx_mzstd compresses on a thread pool

With `zstd_thread_pool`, the module cuts a response into segments of
`zstd_parallel_segment_size`, 1 MiB by default. Each segment becomes an NGINX thread
task and is compressed on one of the pool's threads; up to `zstd_parallel_tasks`
segments of one response, 4 by default, are compressed at once. The completion
handler runs in the event loop, sends the compressed bytes in order and wakes the
connection. Meanwhile the event loop serves other connections. The response is still
one standard zstd frame.

Unlike Brotli segments in [ngx_mbrotli](/2026/ngx-mbrotli-thread-pool-benchmarks/),
zstd segments are not fully independent. Every segment but the first starts by
running through the end of the input before it, so that its matches can reach back across the
boundary. That keeps the compression ratio close to the event loop's, and it costs
CPU time, as shown [below](#where-the-extra-cpu-time-goes).

```nginx
load_module modules/ngx_mzstd.so;

thread_pool zstd threads=4;

http {
    zstd on;
    zstd_comp_level 3;
    zstd_types text/plain text/css application/javascript application/json
               image/svg+xml;

    zstd_thread_pool zstd;
    zstd_parallel_segment_size 4m;
}
```

NGINX must be built with `--with-threads`, as nginx.org's packages are. The pool
named `default` exists without being declared, with 32 threads per worker, and is
shared with `aio threads`. The reason for `4m` is in
[How to configure it](#how-to-configure-it).

## How long do other requests wait?

Small uncompressed requests (`small.json`, 1.9 KB) were sent at 1,000 per second over
32 connections. A second stream requested `react-dom.development.js` (1.03 MB)
compressed, at a constant rate of about half of what tokers/zstd-nginx-module can
sustain. All variants kept up with both streams.

<figure class="chart" id="zstd-latency-even" aria-labelledby="zstd-latency-even-title">
  <p class="chart-title" id="zstd-latency-even-title">p99 latency of small requests, large responses one at a time</p>
  <p class="chart-sub">Large requests arrive on one connection at a constant interval. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>tokers/zstd-nginx-module</li><li><span class="key  c-loop"></span>ngx_mzstd, event loop</li><li><span class="key  c-pool1"></span>ngx_mzstd, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mzstd, pool, 4 tasks</li><li><span class="key ref"></span>no compression, 1.9 ms</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span><span class="ref" style="--x: 0.0802"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 3, react-dom.development.js (1.03 MB), 178 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.1792"><i title="tokers/zstd-nginx-module: 4.2 ms"></i><b>4.2</b></span><span class="bar c-loop" style="--x: 0.1667"><i title="ngx_mzstd, event loop: 3.8 ms"></i><b>3.8</b></span><span class="bar c-pool1" style="--x: 0.0734"><i title="ngx_mzstd, pool, 1 task: 1.8 ms"></i><b>1.8</b></span><span class="bar c-pool4" style="--x: 0.0663"><i title="ngx_mzstd, pool, 4 tasks: 1.7 ms"></i><b>1.7</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 19, react-dom.development.js (1.03 MB), 2 per second</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6605"><i title="tokers/zstd-nginx-module: 198 ms"></i><b>198</b></span><span class="bar c-loop" style="--x: 0.6299"><i title="ngx_mzstd, event loop: 155 ms"></i><b>155</b></span><span class="bar c-pool1" style="--x: 0.0734"><i title="ngx_mzstd, pool, 1 task: 1.8 ms"></i><b>1.8</b></span><span class="bar c-pool4" style="--x: 0.0802"><i title="ngx_mzstd, pool, 4 tasks: 1.9 ms"></i><b>1.9</b></span></span></div>
  </div>
  <figcaption>The same test as the chart at the top, with one 30-second run. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Large responses | Arrival | No compression | tokers/zstd | ngx_mzstd, event loop | Pool, 1 task | Pool, 4 tasks |
|---|---|--:|--:|--:|--:|--:|
| Level 3, 178 per second | 8 at once | 1.9 | 9.0 | 6.9 | 1.7 | 1.8 |
| Level 3, 178 per second | One at a time | 1.9 | 4.2 | 3.8 | 1.8 | 1.7 |
| Level 19, 2 per second | 8 at once | 1.9 | 1,530 | 1,200 | 2.0 | 2.0 |
| Level 19, 2 per second | One at a time | 1.9 | 198 | 155 | 1.8 | 1.9 |

</details>

"8 at once" is the large stream's 8 connections, which wrk2 starts together and which
stay in phase, as when several clients ask for large files at the same moment. "One at
a time" is a single connection at a constant interval, the lower bound of the effect.
On the pool, no small request took more than 3.6 ms one at a time.

Without a thread pool, ngx_mzstd lowers p99 by 10–22% against
tokers/zstd-nginx-module, only because mzstd compresses faster. It blocks the event
loop all the same. The difference in tail latency comes from the thread pool.

The large responses gained too. With 8 arriving together at level 19, each took a
median 319 ms with 4 tasks, 465 ms with 1 task and 789 ms with
tokers/zstd-nginx-module.

## How many requests does one worker serve?

The same worker under closed-loop load, with wrk and 8 connections:

<figure class="chart" id="zstd-rps" aria-labelledby="zstd-rps-title">
  <p class="chart-title" id="zstd-rps-title">Requests per second, relative to tokers/zstd-nginx-module</p>
  <p class="chart-sub">8 connections. 1 task per response serves about the same as 4. Logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key round c-loop"></span>ngx_mzstd, event loop</li><li><span class="key round c-pool4"></span>ngx_mzstd, pool, 4 tasks</li><li><span class="key ref"></span>tokers/zstd-nginx-module = 1×</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.3758"></span><span style="--x: 0.5637"></span><span style="--x: 0.7516"></span><span style="--x: 0.9395"></span><span class="ref" style="--x: 0.1879"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">0.5×</span><span class="tick" style="--x: 0.1879">1×</span><span class="tick" style="--x: 0.3758">2×</span><span class="tick" style="--x: 0.5637">4×</span><span class="tick" style="--x: 0.7516">8×</span><span class="tick" style="--x: 0.9395">16×</span></span></div>
    <p class="chart-group">jquery.min.js, 85 KB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.2350; --b: 0.5399"></span><span class="dot c-loop" style="--x: 0.2350" title="ngx_mzstd, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5399" title="ngx_mzstd, pool, 4 tasks: 3.7×"></span><b class="dot-value" style="--x: 0.5399">3.7×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.1792; --b: 0.5396"></span><span class="dot c-loop" style="--x: 0.1792" title="ngx_mzstd, event loop: 0.97×"></span><span class="dot c-pool4" style="--x: 0.5396" title="ngx_mzstd, pool, 4 tasks: 3.7×"></span><b class="dot-value" style="--x: 0.5396">3.7×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.5603; --b: 0.9239"></span><span class="dot c-loop" style="--x: 0.5603" title="ngx_mzstd, event loop: 4.0×"></span><span class="dot c-pool4" style="--x: 0.9239" title="ngx_mzstd, pool, 4 tasks: 15.1×"></span><b class="dot-value" style="--x: 0.9239">15.1×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.4556; --b: 0.8214"></span><span class="dot c-loop" style="--x: 0.4556" title="ngx_mzstd, event loop: 2.7×"></span><span class="dot c-pool4" style="--x: 0.8214" title="ngx_mzstd, pool, 4 tasks: 10.3×"></span><b class="dot-value" style="--x: 0.8214">10.3×</b></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.2277; --b: 0.5335"></span><span class="dot c-loop" style="--x: 0.2277" title="ngx_mzstd, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5335" title="ngx_mzstd, pool, 4 tasks: 3.6×"></span><b class="dot-value" style="--x: 0.5335">3.6×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.1865; --b: 0.4553"></span><span class="dot c-loop" style="--x: 0.1865" title="ngx_mzstd, event loop: 0.99×"></span><span class="dot c-pool4" style="--x: 0.4553" title="ngx_mzstd, pool, 4 tasks: 2.7×"></span><b class="dot-value" style="--x: 0.4553">2.7×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.2634; --b: 0.5517"></span><span class="dot c-loop" style="--x: 0.2634" title="ngx_mzstd, event loop: 1.3×"></span><span class="dot c-pool4" style="--x: 0.5517" title="ngx_mzstd, pool, 4 tasks: 3.8×"></span><b class="dot-value" style="--x: 0.5517">3.8×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.2562; --b: 0.5096"></span><span class="dot c-loop" style="--x: 0.2562" title="ngx_mzstd, event loop: 1.3×"></span><span class="dot c-pool4" style="--x: 0.5096" title="ngx_mzstd, pool, 4 tasks: 3.3×"></span><b class="dot-value" style="--x: 0.5096">3.3×</b></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.2316; --b: 0.5486"></span><span class="dot c-loop" style="--x: 0.2316" title="ngx_mzstd, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.5486" title="ngx_mzstd, pool, 4 tasks: 3.8×"></span><b class="dot-value" style="--x: 0.5486">3.8×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.1914; --b: 0.4159"></span><span class="dot c-loop" style="--x: 0.1914" title="ngx_mzstd, event loop: 1.0×"></span><span class="dot c-pool4" style="--x: 0.4159" title="ngx_mzstd, pool, 4 tasks: 2.3×"></span><b class="dot-value" style="--x: 0.4159">2.3×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.2241; --b: 0.4054"></span><span class="dot c-loop" style="--x: 0.2241" title="ngx_mzstd, event loop: 1.1×"></span><span class="dot c-pool4" style="--x: 0.4054" title="ngx_mzstd, pool, 4 tasks: 2.2×"></span><b class="dot-value" style="--x: 0.4054">2.2×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.2473; --b: 0.4541"></span><span class="dot c-loop" style="--x: 0.2473" title="ngx_mzstd, event loop: 1.2×"></span><span class="dot c-pool4" style="--x: 0.4541" title="ngx_mzstd, pool, 4 tasks: 2.7×"></span><b class="dot-value" style="--x: 0.4541">2.7×</b></span></div>
  </div>
  <figcaption>wrk, median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | tokers/zstd | ngx_mzstd, event loop | Difference | Pool, 1 task | Difference | Pool, 4 tasks | Difference |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| jquery.min.js, 85 KB | 3 | 3,469 | 4,127 | +19% | 12,850 | 3.7× | 12,710 | 3.7× |
| jquery.min.js, 85 KB | 9 | 841 | 814 | −3% | 3,162 | 3.8× | 3,077 | 3.7× |
| jquery.min.js, 85 KB | 15 | 50.7 | 200 | 4.0× | 764 | 15.1× | 765 | 15.1× |
| jquery.min.js, 85 KB | 19 | 31.3 | 83.9 | 2.7× | 323 | 10.3× | 324 | 10.3× |
| react-dom.development.js, 1.03 MB | 3 | 357 | 414 | +16% | 1,283 | 3.6× | 1,278 | 3.6× |
| react-dom.development.js, 1.03 MB | 9 | 91.1 | 90.6 | −1% | 251 | 2.8× | 244 | 2.7× |
| react-dom.development.js, 1.03 MB | 15 | 12.0 | 15.8 | +32% | 47.7 | 4.0× | 45.9 | 3.8× |
| react-dom.development.js, 1.03 MB | 19 | 4.99 | 6.42 | +29% | 16.5 | 3.3× | 16.4 | 3.3× |
| libraries.json, 2.2 MB | 3 | 174 | 204 | +17% | 656 | 3.8× | 658 | 3.8× |
| libraries.json, 2.2 MB | 9 | 48.0 | 48.6 | +1% | 112 | 2.3× | 111 | 2.3× |
| libraries.json, 2.2 MB | 15 | 6.99 | 7.99 | +14% | 18.7 | 2.7× | 15.6 | 2.2× |
| libraries.json, 2.2 MB | 19 | 2.45 | 3.05 | +24% | 6.54 | 2.7× | 6.54 | 2.7× |

</details>

The pool's 4 threads use the 4 CPUs that one worker in the event loop cannot. On the
1–2.2 MB files at levels 9–19 the pool gains only 2.1–3.0× over the event loop, because of the extra CPU
time explained below.

**Small responses at high levels.** On `small.json` (1.9 KB) at levels 15 and 19,
tokers/zstd-nginx-module served 46–58 requests per second, spending 18–22 ms of CPU
time and up to 85 MiB on each response. ngx_mzstd served 5,100–9,200 in the event
loop and 17,000–29,000 on the pool. tokers/zstd-nginx-module probably sizes its
encoder for the level's full window because it does not pass the response length to
zstd; that was not verified.

## How fast is one large response?

Time to serve one `libraries.json` (2.2 MB, three 1 MiB segments) over one
connection:

<figure class="chart" id="zstd-single" aria-labelledby="zstd-single-title">
  <p class="chart-title" id="zstd-single-title">Time to serve one 2.2 MB response</p>
  <p class="chart-sub">libraries.json, three 1 MiB segments, one connection. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>tokers/zstd-nginx-module</li><li><span class="key  c-loop"></span>ngx_mzstd, event loop</li><li><span class="key  c-pool1"></span>ngx_mzstd, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mzstd, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.2196"><i title="tokers/zstd-nginx-module: 5.8 ms"></i><b>5.8</b></span><span class="bar c-loop" style="--x: 0.1985"><i title="ngx_mzstd, event loop: 4.9 ms"></i><b>4.9</b></span><span class="bar c-pool1" style="--x: 0.2152"><i title="ngx_mzstd, pool, 1 task: 5.6 ms"></i><b>5.6</b></span><span class="bar c-pool4" style="--x: 0.1529"><i title="ngx_mzstd, pool, 4 tasks: 3.4 ms"></i><b>3.4</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.3785"><i title="tokers/zstd-nginx-module: 20.7 ms"></i><b>20.7</b></span><span class="bar c-loop" style="--x: 0.3803"><i title="ngx_mzstd, event loop: 21.0 ms"></i><b>21.0</b></span><span class="bar c-pool1" style="--x: 0.4293"><i title="ngx_mzstd, pool, 1 task: 31.1 ms"></i><b>31.1</b></span><span class="bar c-pool4" style="--x: 0.3568"><i title="ngx_mzstd, pool, 4 tasks: 17.4 ms"></i><b>17.4</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6199"><i title="tokers/zstd-nginx-module: 143 ms"></i><b>143</b></span><span class="bar c-loop" style="--x: 0.6000"><i title="ngx_mzstd, event loop: 122 ms"></i><b>122</b></span><span class="bar c-pool1" style="--x: 0.6291"><i title="ngx_mzstd, pool, 1 task: 154 ms"></i><b>154</b></span><span class="bar c-pool4" style="--x: 0.5578"><i title="ngx_mzstd, pool, 4 tasks: 87 ms"></i><b>87</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.7535"><i title="tokers/zstd-nginx-module: 417 ms"></i><b>417</b></span><span class="bar c-loop" style="--x: 0.7258"><i title="ngx_mzstd, event loop: 334 ms"></i><b>334</b></span><span class="bar c-pool1" style="--x: 0.7897"><i title="ngx_mzstd, pool, 1 task: 557 ms"></i><b>557</b></span><span class="bar c-pool4" style="--x: 0.6901"><i title="ngx_mzstd, pool, 4 tasks: 251 ms"></i><b>251</b></span></span></div>
  </div>
  <figcaption>wrk, median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Level | tokers/zstd | ngx_mzstd, event loop | Pool, 1 task | Pool, 4 tasks |
|--:|--:|--:|--:|--:|
| 3 | 5.8 | 4.9 | 5.6 | 3.4 |
| 9 | 20.7 | 21.0 | 31.1 | 17.4 |
| 15 | 143 | 122 | 154 | 87 |
| 19 | 417 | 334 | 557 | 251 |

</details>

4 tasks served it 1.6–2.2 times as fast as 1 task, and 1.2–1.7 times as fast as
tokers/zstd-nginx-module. With 1 task, the pool was 26–67% slower than the event loop
at levels 9–19: that is the segment overlap. Responses up to 1 MiB fit in one segment,
so they do not depend on the number of tasks.

## Where the extra CPU time goes


<figure class="chart" id="zstd-cpu" aria-labelledby="zstd-cpu-title">
  <p class="chart-title" id="zstd-cpu-title">CPU time per request</p>
  <p class="chart-sub">Worker and pool threads together, 8 connections. ms, logarithmic scale.</p>
  <ul class="chart-legend"><li><span class="key  c-stock"></span>tokers/zstd-nginx-module</li><li><span class="key  c-loop"></span>ngx_mzstd, event loop</li><li><span class="key  c-pool1"></span>ngx_mzstd, pool, 1 task</li><li><span class="key  c-pool4"></span>ngx_mzstd, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2876"></span><span style="--x: 0.5752"></span><span style="--x: 0.8628"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">1</span><span class="tick" style="--x: 0.2876">10</span><span class="tick" style="--x: 0.5752">100</span><span class="tick" style="--x: 0.8628">1,000</span></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.1286"><i title="tokers/zstd-nginx-module: 2.8 ms"></i><b>2.8</b></span><span class="bar c-loop" style="--x: 0.1093"><i title="ngx_mzstd, event loop: 2.4 ms"></i><b>2.4</b></span><span class="bar c-pool1" style="--x: 0.1372"><i title="ngx_mzstd, pool, 1 task: 3.0 ms"></i><b>3.0</b></span><span class="bar c-pool4" style="--x: 0.1413"><i title="ngx_mzstd, pool, 4 tasks: 3.1 ms"></i><b>3.1</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.2995"><i title="tokers/zstd-nginx-module: 11.0 ms"></i><b>11.0</b></span><span class="bar c-loop" style="--x: 0.3006"><i title="ngx_mzstd, event loop: 11.1 ms"></i><b>11.1</b></span><span class="bar c-pool1" style="--x: 0.3455"><i title="ngx_mzstd, pool, 1 task: 15.9 ms"></i><b>15.9</b></span><span class="bar c-pool4" style="--x: 0.3494"><i title="ngx_mzstd, pool, 4 tasks: 16.4 ms"></i><b>16.4</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6624"><i title="tokers/zstd-nginx-module: 201 ms"></i><b>201</b></span><span class="bar c-loop" style="--x: 0.6315"><i title="ngx_mzstd, event loop: 157 ms"></i><b>157</b></span><span class="bar c-pool1" style="--x: 0.6861"><i title="ngx_mzstd, pool, 1 task: 243 ms"></i><b>243</b></span><span class="bar c-pool4" style="--x: 0.6881"><i title="ngx_mzstd, pool, 4 tasks: 247 ms"></i><b>247</b></span></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.3791"><i title="tokers/zstd-nginx-module: 20.8 ms"></i><b>20.8</b></span><span class="bar c-loop" style="--x: 0.3779"><i title="ngx_mzstd, event loop: 20.6 ms"></i><b>20.6</b></span><span class="bar c-pool1" style="--x: 0.4458"><i title="ngx_mzstd, pool, 1 task: 35.5 ms"></i><b>35.5</b></span><span class="bar c-pool4" style="--x: 0.4479"><i title="ngx_mzstd, pool, 4 tasks: 36.1 ms"></i><b>36.1</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.6216"><i title="tokers/zstd-nginx-module: 145 ms"></i><b>145</b></span><span class="bar c-loop" style="--x: 0.6041"><i title="ngx_mzstd, event loop: 126 ms"></i><b>126</b></span><span class="bar c-pool1" style="--x: 0.6714"><i title="ngx_mzstd, pool, 1 task: 216 ms"></i><b>216</b></span><span class="bar c-pool4" style="--x: 0.6979"><i title="ngx_mzstd, pool, 4 tasks: 267 ms"></i><b>267</b></span></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot bars"><span class="bar c-stock" style="--x: 0.7517"><i title="tokers/zstd-nginx-module: 411 ms"></i><b>411</b></span><span class="bar c-loop" style="--x: 0.7247"><i title="ngx_mzstd, event loop: 331 ms"></i><b>331</b></span><span class="bar c-pool1" style="--x: 0.8023"><i title="ngx_mzstd, pool, 1 task: 616 ms"></i><b>616</b></span><span class="bar c-pool4" style="--x: 0.8041"><i title="ngx_mzstd, pool, 4 tasks: 625 ms"></i><b>625</b></span></span></div>
  </div>
  <figcaption>Median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | tokers/zstd | ngx_mzstd, event loop | Pool, 1 task | Pool, 4 tasks |
|---|--:|--:|--:|--:|--:|
| react-dom.development.js, 1.03 MB | 3 | 2.8 | 2.4 | 3.0 | 3.1 |
| react-dom.development.js, 1.03 MB | 9 | 11.0 | 11.1 | 15.9 | 16.4 |
| react-dom.development.js, 1.03 MB | 19 | 201 | 157 | 243 | 247 |
| libraries.json, 2.2 MB | 9 | 20.8 | 20.6 | 35.5 | 36.1 |
| libraries.json, 2.2 MB | 15 | 145 | 126 | 216 | 267 |
| libraries.json, 2.2 MB | 19 | 411 | 331 | 616 | 625 |

</details>

At levels 9–19 the pool needed 1.4–2.1 times the CPU time of the event loop, and in
most cases more than tokers/zstd-nginx-module. Two causes were measured.

**Segment overlap.** Before compressing its own input, every segment but the first
compresses and throws away the end of the previous segment, so that its matches can
reach back. At levels that use the lazy match finders, that is 1/8 of the window: on
`libraries.json`, 512 KiB for every 1 MiB segment. At levels 19 and above, a segment
loads the whole window as a prefix. Measured in the library alone, on one thread, with
1 MiB segments, `libraries.json` took 1.21–1.69 times the CPU time of the event loop
at levels 9–19, and 0.79–0.98 times without the overlap.

<details class="numbers" markdown="1">
<summary>The library measurements as a table</summary>

| Measurement | Level 9 | Level 15 | Level 19 |
|---|--:|--:|--:|
| ngx_mzstd, event loop, 8 connections | 20.6 | 126 | 331 |
| mzstd, 1 MiB segments | 30.1 (×1.45) | 156 (×1.21) | 559 (×1.69) |
| mzstd, 1 MiB segments without overlap | 20.3 (×0.98) | 101 (×0.79) | 315 (×0.95) |
| ngx_mzstd, pool, 1 task, 1 connection | 31.4 | 156 | 558 |
| ngx_mzstd, pool, 1 task, 8 connections | 35.5 | 216 | 616 |

CPU time per `libraries.json` response, in ms.

</details>

Without overlap, compressing in segments costs no more than compressing in one piece.
At 1 connection, ngx_mzstd on the pool costs what the library costs, within 0.1×, so
handing segments to the pool costs almost nothing. The overlap buys compression
ratio: without it, the output would be 2.5–6.2% larger instead of 0.04–1.4%.

**Encoders allocated anew.** A worker keeps encoders for `zstd_parallel_compressors`
compressors, 4 by default. With 8 responses in flight, the others allocate their
tables for every response. At level 15, that showed up as 14,000 page faults and
23 ms of system time per response with 1 task, and 35,000 and 64 ms with 4 tasks.
`zstd_parallel_compressors 8` lowered CPU time per request from 211 to 185 ms with
1 task and from 272 to 185 ms with 4 tasks, and served 14% and 46% more requests.

About 30 ms per response at level 15 remains unexplained (185 ms against 156 ms at
1 connection). It is not threads competing for cache: a pool of one thread needed the
same 181 ms.

## What the thread pool costs

**Memory.** On a pool, every response being sent holds encoders for its segments
until it is sent, so peak memory grows with the number of responses in flight and
the number of tasks per response.

<figure class="chart" id="zstd-memory" aria-labelledby="zstd-memory-title">
  <p class="chart-title" id="zstd-memory-title">Peak memory of the worker</p>
  <p class="chart-sub">VmHWM at 8 connections, MiB, logarithmic scale. The labelled value is the pool with 4 tasks.</p>
  <ul class="chart-legend"><li><span class="key round c-stock"></span>tokers/zstd-nginx-module</li><li><span class="key round c-loop"></span>ngx_mzstd, event loop</li><li><span class="key round c-pool1"></span>ngx_mzstd, pool, 1 task</li><li><span class="key round c-pool4"></span>ngx_mzstd, pool, 4 tasks</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.0000"></span><span style="--x: 0.2222"></span><span style="--x: 0.4444"></span><span style="--x: 0.6667"></span><span style="--x: 0.8889"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick first" style="--x: 0.0000">4</span><span class="tick" style="--x: 0.2222">16</span><span class="tick" style="--x: 0.4444">64</span><span class="tick" style="--x: 0.6667">256</span><span class="tick" style="--x: 0.8889">1,024</span></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.0650; --b: 0.4494"></span><span class="dot c-stock" style="--x: 0.0650" title="tokers/zstd-nginx-module: 6 MiB"></span><span class="dot c-loop" style="--x: 0.0897" title="ngx_mzstd, event loop: 7 MiB"></span><span class="dot c-pool1" style="--x: 0.4112" title="ngx_mzstd, pool, 1 task: 52 MiB"></span><span class="dot c-pool4" style="--x: 0.4494" title="ngx_mzstd, pool, 4 tasks: 66 MiB"></span><b class="dot-value" style="--x: 0.4494">66 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.2222; --b: 0.6438"></span><span class="dot c-stock" style="--x: 0.2222" title="tokers/zstd-nginx-module: 16 MiB"></span><span class="dot c-loop" style="--x: 0.2222" title="ngx_mzstd, event loop: 16 MiB"></span><span class="dot c-pool1" style="--x: 0.5842" title="ngx_mzstd, pool, 1 task: 153 MiB"></span><span class="dot c-pool4" style="--x: 0.6438" title="ngx_mzstd, pool, 4 tasks: 222 MiB"></span><b class="dot-value" style="--x: 0.6438">222 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.3609; --b: 0.7958"></span><span class="dot c-stock" style="--x: 0.4588" title="tokers/zstd-nginx-module: 70 MiB"></span><span class="dot c-loop" style="--x: 0.3609" title="ngx_mzstd, event loop: 38 MiB"></span><span class="dot c-pool1" style="--x: 0.7456" title="ngx_mzstd, pool, 1 task: 419 MiB"></span><span class="dot c-pool4" style="--x: 0.7958" title="ngx_mzstd, pool, 4 tasks: 573 MiB"></span><b class="dot-value" style="--x: 0.7958">573 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.3650; --b: 0.7927"></span><span class="dot c-stock" style="--x: 0.4918" title="tokers/zstd-nginx-module: 86 MiB"></span><span class="dot c-loop" style="--x: 0.3650" title="ngx_mzstd, event loop: 39 MiB"></span><span class="dot c-pool1" style="--x: 0.7691" title="ngx_mzstd, pool, 1 task: 485 MiB"></span><span class="dot c-pool4" style="--x: 0.7927" title="ngx_mzstd, pool, 4 tasks: 562 MiB"></span><b class="dot-value" style="--x: 0.7927">562 MiB</b></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.0897; --b: 0.4973"></span><span class="dot c-stock" style="--x: 0.0897" title="tokers/zstd-nginx-module: 7 MiB"></span><span class="dot c-loop" style="--x: 0.1111" title="ngx_mzstd, event loop: 8 MiB"></span><span class="dot c-pool1" style="--x: 0.4419" title="ngx_mzstd, pool, 1 task: 63 MiB"></span><span class="dot c-pool4" style="--x: 0.4973" title="ngx_mzstd, pool, 4 tasks: 89 MiB"></span><b class="dot-value" style="--x: 0.4973">89 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.2319; --b: 0.6942"></span><span class="dot c-stock" style="--x: 0.2319" title="tokers/zstd-nginx-module: 17 MiB"></span><span class="dot c-loop" style="--x: 0.2319" title="ngx_mzstd, event loop: 17 MiB"></span><span class="dot c-pool1" style="--x: 0.6120" title="ngx_mzstd, pool, 1 task: 182 MiB"></span><span class="dot c-pool4" style="--x: 0.6942" title="ngx_mzstd, pool, 4 tasks: 304 MiB"></span><b class="dot-value" style="--x: 0.6942">304 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.4588; --b: 0.9031"></span><span class="dot c-stock" style="--x: 0.4588" title="tokers/zstd-nginx-module: 70 MiB"></span><span class="dot c-loop" style="--x: 0.4611" title="ngx_mzstd, event loop: 71 MiB"></span><span class="dot c-pool1" style="--x: 0.7815" title="ngx_mzstd, pool, 1 task: 524 MiB"></span><span class="dot c-pool4" style="--x: 0.9031" title="ngx_mzstd, pool, 4 tasks: 1,119 MiB"></span><b class="dot-value" style="--x: 0.9031">1,119 MiB</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.4230; --b: 0.8787"></span><span class="dot c-stock" style="--x: 0.4937" title="tokers/zstd-nginx-module: 87 MiB"></span><span class="dot c-loop" style="--x: 0.4230" title="ngx_mzstd, event loop: 56 MiB"></span><span class="dot c-pool1" style="--x: 0.7781" title="ngx_mzstd, pool, 1 task: 513 MiB"></span><span class="dot c-pool4" style="--x: 0.8787" title="ngx_mzstd, pool, 4 tasks: 961 MiB"></span><b class="dot-value" style="--x: 0.8787">961 MiB</b></span></div>
  </div>
  <figcaption>Highest of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | tokers/zstd | ngx_mzstd, event loop | Pool, 1 task | Pool, 4 tasks |
|---|--:|--:|--:|--:|--:|
| react-dom.development.js, 1.03 MB | 3 | 6 | 7 | 52 | 66 |
| react-dom.development.js, 1.03 MB | 9 | 16 | 16 | 153 | 222 |
| react-dom.development.js, 1.03 MB | 15 | 70 | 38 | 419 | 573 |
| react-dom.development.js, 1.03 MB | 19 | 86 | 39 | 485 | 562 |
| libraries.json, 2.2 MB | 3 | 7 | 8 | 63 | 89 |
| libraries.json, 2.2 MB | 9 | 17 | 17 | 182 | 304 |
| libraries.json, 2.2 MB | 15 | 70 | 71 | 524 | 1,119 |
| libraries.json, 2.2 MB | 19 | 87 | 56 | 513 | 961 |

</details>

In the event loop, ngx_mzstd needs about as much as tokers/zstd-nginx-module, and less
at levels 15 and 19. On the pool it needs 6–18 times as much, up to 1.1 GiB.

**Compression ratio.** With 1m segments, responses longer than one segment came out
0–1.3% larger than in the event loop. With 4m, the files here were the same size.

## How to configure it

- **Set `zstd_parallel_segment_size 4m`.** Both files here then fit in one segment,
  so a response is compressed by one task with no overlap. With 1 task at
  8 connections, CPU time per request was 1.04–1.21 times the event loop's instead of
  1.20–1.97, a worker served 15–69% more requests, peak memory was up to 31% lower and
  the output was as small as in the event loop. One response at a time was served
  within 6% of the event loop's time. The cost: only responses longer than 4 MiB are
  split across threads.

<figure class="chart" id="zstd-segment" aria-labelledby="zstd-segment-title">
  <p class="chart-title" id="zstd-segment-title">CPU time per request on the pool, relative to the event loop</p>
  <p class="chart-sub">Pool with 1 task, 8 connections.</p>
  <ul class="chart-legend"><li><span class="key round ring c-pool1"></span>1m segments (default)</li><li><span class="key round c-pool1"></span>4m segments</li><li><span class="key ref"></span>event loop = 1×</li></ul>
  <div class="chart-body">
    <div class="chart-grid" aria-hidden="true"><span style="--x: 0.5625"></span><span style="--x: 0.8750"></span><span class="ref" style="--x: 0.2500"></span></div>
    <div class="chart-axis" aria-hidden="true"><span></span><span class="plot"><span class="tick" style="--x: 0.2500">1.0×</span><span class="tick" style="--x: 0.5625">1.5×</span><span class="tick" style="--x: 0.8750">2.0×</span></span></div>
    <p class="chart-group">react-dom.development.js, 1.03 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.2760; --b: 0.4062"></span><span class="dot ring c-pool1" style="--x: 0.4062" title="1m segments: 1.25×"></span><span class="dot c-pool1" style="--x: 0.2760" title="4m segments: 1.04×"></span><b class="dot-value" style="--x: 0.4062">1.25×</b><b class="dot-value left" style="--x: 0.2760">1.04×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.3288; --b: 0.5203"></span><span class="dot ring c-pool1" style="--x: 0.5203" title="1m segments: 1.43×"></span><span class="dot c-pool1" style="--x: 0.3288" title="4m segments: 1.13×"></span><b class="dot-value" style="--x: 0.5203">1.43×</b><b class="dot-value left" style="--x: 0.3288">1.13×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.3822; --b: 0.5076"></span><span class="dot ring c-pool1" style="--x: 0.5076" title="1m segments: 1.41×"></span><span class="dot c-pool1" style="--x: 0.3822" title="4m segments: 1.21×"></span><b class="dot-value" style="--x: 0.5076">1.41×</b><b class="dot-value left" style="--x: 0.3822">1.21×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.3018; --b: 0.6242"></span><span class="dot ring c-pool1" style="--x: 0.6242" title="1m segments: 1.60×"></span><span class="dot c-pool1" style="--x: 0.3018" title="4m segments: 1.08×"></span><b class="dot-value" style="--x: 0.6242">1.60×</b><b class="dot-value left" style="--x: 0.3018">1.08×</b></span></div>
    <p class="chart-group">libraries.json, 2.2 MB</p>
    <div class="chart-row"><span class="chart-label">Level 3</span><span class="plot dots"><span class="span" style="--a: 0.2755; --b: 0.3776"></span><span class="dot ring c-pool1" style="--x: 0.3776" title="1m segments: 1.20×"></span><span class="dot c-pool1" style="--x: 0.2755" title="4m segments: 1.04×"></span><b class="dot-value" style="--x: 0.3776">1.20×</b><b class="dot-value left" style="--x: 0.2755">1.04×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 9</span><span class="plot dots"><span class="span" style="--a: 0.3501; --b: 0.7172"></span><span class="dot ring c-pool1" style="--x: 0.7172" title="1m segments: 1.75×"></span><span class="dot c-pool1" style="--x: 0.3501" title="4m segments: 1.16×"></span><b class="dot-value" style="--x: 0.7172">1.75×</b><b class="dot-value left" style="--x: 0.3501">1.16×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 15</span><span class="plot dots"><span class="span" style="--a: 0.5972; --b: 0.7262"></span><span class="dot ring c-pool1" style="--x: 0.7262" title="1m segments: 1.76×"></span><span class="dot c-pool1" style="--x: 0.5972" title="4m segments: 1.56×"></span><b class="dot-value" style="--x: 0.7262">1.76×</b><b class="dot-value left" style="--x: 0.5972">1.56×</b></span></div>
    <div class="chart-row"><span class="chart-label">Level 19</span><span class="plot dots"><span class="span" style="--a: 0.3520; --b: 0.8580"></span><span class="dot ring c-pool1" style="--x: 0.8580" title="1m segments: 1.97×"></span><span class="dot c-pool1" style="--x: 0.3520" title="4m segments: 1.16×"></span><b class="dot-value" style="--x: 0.8580">1.97×</b><b class="dot-value left" style="--x: 0.3520">1.16×</b></span></div>
  </div>
  <figcaption>Median of three runs. NGINX 1.30.6, one worker on 4 CPUs, a pool of 4 threads; 20 October 2026.</figcaption>
</figure>

<details class="numbers" markdown="1">
<summary>Numbers as a table</summary>

| Response | Level | CPU, event loop | CPU, 1m | CPU, 4m | Peak memory, 1m | Peak memory, 4m |
|---|--:|--:|--:|--:|--:|--:|
| react-dom.development.js, 1.03 MB | 3 | 2.4 ms | 3.0 ms | 2.5 ms | 55 MiB | 43 MiB |
| react-dom.development.js, 1.03 MB | 9 | 11.1 ms | 15.9 ms | 12.5 ms | 171 MiB | 139 MiB |
| react-dom.development.js, 1.03 MB | 15 | 63.8 ms | 90.1 ms | 77.3 ms | 423 MiB | 312 MiB |
| react-dom.development.js, 1.03 MB | 19 | 157 ms | 251 ms | 170 ms | 456 MiB | 314 MiB |
| libraries.json, 2.2 MB | 3 | 4.9 ms | 5.9 ms | 5.1 ms | 59 MiB | 60 MiB |
| libraries.json, 2.2 MB | 9 | 20.6 ms | 36.0 ms | 23.9 ms | 177 MiB | 161 MiB |
| libraries.json, 2.2 MB | 15 | 126 ms | 222 ms | 196 ms | 527 MiB | 492 MiB |
| libraries.json, 2.2 MB | 19 | 331 ms | 653 ms | 385 ms | 505 MiB | 414 MiB |

</details>

Pool with 1 task, 8 connections. Level 15 on the 2.2 MB file stays at 1.56 times the
event loop's CPU time, because of the encoders allocated anew.

- **Raise `zstd_parallel_compressors`** to about the number of responses a worker
  compresses at once. With 8 connections, `8` instead of the default 4 cut CPU time at
  level 15 by 12–32%. What it does to peak memory was not measured.
- **Declare a pool of your own** with `thread_pool zstd threads=N;`. The benchmark
  used 4 threads on 4 CPUs; pool sizes were not compared.
- **Lower `zstd_parallel_tasks` to save memory.** On the 2.2 MB file, 4 tasks needed up
  to 2.1 times the memory of 1, and under load served no more requests.
- **Bound encoder memory** between responses with `zstd_retention_policy bounded
  <size>` or `release_all`.

The [ngx_mzstd README](https://github.com/M-Compressors/ngx_mzstd#configuration-directives)
documents every directive.

## When you do not need it

- **Static files** are better compressed once, at build time, and served with
  `zstd_static on;`.
- **Low levels on small responses.** At level 3 a 1 MB response took 2.8 ms of CPU
  time with tokers/zstd-nginx-module, and other requests waited up to 4.2–9.0 ms at
  p99. If that is acceptable, the pool mostly adds memory.
- **A CDN that compresses** for you takes the work off NGINX.

## How it was measured

**Hardware.** Intel Core i7-13700KF, Windows 10.0.26300.9711, WSL 2.7.14.0 with kernel
6.18.33.2-microsoft-standard-WSL2, Ubuntu 22.04.5. WSL2 shows 12 identical cores with
2 threads each and does not tell which are performance cores, so some of the pinned
CPUs may be efficiency cores. Traffic went over loopback without TLS, and files were
served from tmpfs (`/dev/shm`).

**Build.** NGINX 1.30.6, `./configure --with-compat --with-threads
--without-http_rewrite_module`, gcc 11.4.0, both modules dynamic.
tokers/zstd-nginx-module at commit `057a7d3` with libzstd 1.5.7. ngx_mzstd 0.2.2
(commit `ccd2bcf`) with mzstd 0.2.7, built with rustc 1.99.0. The current release is
ngx_mzstd 0.2.3; the run has not been repeated on it.

**Configuration.** `worker_processes 1`, with the worker and its pool pinned to 4
physical cores, and `thread_pool cp threads=4`. On the pool, `zstd_thread_pool cp`
with `zstd_parallel_tasks 1` or the default 4. Everything else was left at its
default, including 1m segments, `zstd_parallel_compressors 4` and encoder reuse,
except where a section says otherwise.

**Load.** Requests per second and CPU time: wrk 4.1.0 on 4 other physical cores, 2
threads and 8 connections, 4 seconds per run (8 seconds for files over 1 MB, 5 times
as long at level 19) after a 1-second warm-up. NGINX was restarted for every run, and
each run started once the worker had been idle for 300 ms. Three runs, in an order
shuffled between runs; tables give the median. CPU time is the worker's user and
system time from `/proc/<pid>/stat`, including the pool's threads. Latency: two wrk2
streams (commit `44a94c1`) at once, open loop, with coordinated omission corrected;
8 at once is the median of three 30-second runs, one at a time is a single 30-second
run. The library measurements ran on one core, the median of 5–7 iterations.

**Files.** jQuery 3.7.1 (`jquery.min.js`, 85 KB) and React DOM 18.3.1
(`react-dom.development.js`, 1.03 MB) from cdnjs, the full cdnjs API listing
(`libraries.json`, 2.2 MB) and its first 10 entries (`small.json`, 1.9 KB), all
fetched on 20 October 2026.

**Correctness.** Before the runs, every response in every combination of module,
variant, level and file was decoded with curl's zstd decoder and compared with the
original by SHA-256. All matched.

**Not measured.** gzip, more than one worker process, pool sizes other than 4
threads, a response-size threshold for the pool, HTTP/2 and HTTP/3, slow clients,
long runs, responses longer than 4 MiB and bare-metal Linux. Runs were 3 per cell and
4–40 seconds long, shorter than a full benchmark.

## Install it

ngx_mzstd has packages for Debian, Ubuntu, RHEL and its derivatives, and Amazon Linux:
[install it from packages](/2026/install-ngx-mzstd-packages/), or
[build it from source](/2026/build-ngx-mzstd-from-source/). Existing
tokers/zstd-nginx-module configuration keeps working; add `zstd_thread_pool` to move
compression off the event loop.

The same measurements for Brotli, with ngx_mbrotli against google/ngx_brotli, are in
[Brotli on NGINX thread pools](/2026/ngx-mbrotli-thread-pool-benchmarks/).
