---
title: About
description: Who makes M-Compressors, what the projects promise, and how to reach the maintainer.
permalink: /about/
---

M-Compressors is an open-source organization that rewrites compression codecs in
Rust. Production code in its codecs forbids `unsafe`, and each codec is tested
against the C reference it replaces, so it can stand in for it without changing a
single output byte where that is possible.

## Projects

{% for p in site.data.projects -%}
- **[{{ p.name }}]({{ p.repo }})**, {{ p.kind | downcase }}: {{ p.summary | strip }}
{% endfor %}

## What "byte-identical" means here

For the same input and settings, mbrotli writes the bytes Google Brotli 1.2.0
writes at qualities 0–11, and mzstd writes the bytes zstd 1.5.7 writes at every
level. Caches, content hashes and pre-compressed files built with the C encoders
stay valid after switching. Each repository documents the exact settings under which
this holds and the cases where it does not, such as parallel compression.

## Maintainer

The projects are written and maintained by
[{{ site.author.name }}]({{ site.author.url }}). Bug reports and questions go to
the issue tracker of the project they concern on
[GitHub](https://github.com/{{ site.github_org }}).

## Using this site's content

Posts may be quoted, summarized and cited by people and by AI systems, with a link
to the post. A plain-text index of the site is at [llms.txt](/llms.txt) and the
full text at [llms-full.txt](/llms-full.txt).
