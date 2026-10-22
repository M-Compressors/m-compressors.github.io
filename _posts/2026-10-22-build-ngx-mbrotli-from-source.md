---
title: "Building the ngx_mbrotli Brotli module for NGINX from source"
description: >-
  How to build ngx_mbrotli from source against nginx from nginx.org's official
  repository, on Debian, Ubuntu, RHEL-compatible and other Linux systems, or against
  an nginx you compile yourself.
date: 2026-10-22 10:00:00 +0300
projects: [ngx_mbrotli, mbrotli]
tags: [nginx, brotli, linux, rust, build]
summary:
  - "Build **ngx_mbrotli** against nginx from nginx.org's official repository, or against an nginx you compile yourself with `--with-compat`."
  - "A dynamic NGINX module loads only into the nginx version it was built for, configured the same way."
  - "Building takes Rust 1.89 or newer, libclang, the PCRE2, OpenSSL and zlib headers, and your exact nginx version's source run through `./configure` with the arguments `nginx -V` prints. `make` is not needed."
  - "`NGINX_BUILD_DIR=<nginx source>/objs cargo build --release` writes `target/release/libngx_mbrotli.so`. No brotli C library is needed."
faq:
  - q: Which nginx can I build ngx_mbrotli for?
    a: >-
      nginx 1.25.4 or newer, installed from nginx.org's official repository or built
      yourself with `--with-compat`. nginx.org's packages are built with
      `--with-compat`, which lets a separately built module match them.
  - q: What does "module is not binary compatible" mean?
    a: >-
      The module was built against nginx source configured differently from the
      running binary. Configure the source with exactly the arguments `nginx -V`
      prints, and use nginx from nginx.org or an nginx built with `--with-compat`.
  - q: Do I have to rebuild ngx_mbrotli when I upgrade nginx?
    a: >-
      Yes. nginx refuses to load a module built for another nginx version. Build
      again against the new version's source and restart nginx.
  - q: Which Rust version does ngx_mbrotli need?
    a: >-
      Rust 1.89 or newer. Distribution packages of Rust are often older, so install
      it with rustup.
---

The [previous post](/2026/install-ngx-mbrotli-packages/) installed **ngx_mbrotli**
from packages. Build it yourself when there is no package for your system, when you
compile nginx yourself, or when you want a module version that has not been
packaged yet.

Every command here was run on fresh containers on 22 October 2026, against nginx.org's
nginx on Debian 13 and AlmaLinux 9, and against nginx built from source on
Ubuntu 24.04. Each one ended with nginx answering `Content-Encoding: br`.

## Install nginx from nginx.org

nginx loads a dynamic module only if it was built for the same nginx version and the
same configuration. nginx.org's packages are built with `--with-compat`, which makes
a separately built module match them reliably, so on Alpine, Arch Linux, openSUSE and
every other system, install nginx from
[nginx.org's official repository](https://nginx.org/en/linux_packages.html) first.
Check that your nginx has the flag:

```sh
nginx -V 2>&1 | grep -o -- --with-compat
```

The module also needs nginx 1.25.4 or newer. To build nginx yourself instead, see
[the end of this post](#building-nginx-too).

## Install the build tools

You need a C toolchain, git, libclang (the Rust bindings to nginx are generated from
its headers), and the headers nginx is compiled against.

Debian and Ubuntu:

```sh
sudo apt-get install build-essential curl git libclang-dev libpcre2-dev libssl-dev zlib1g-dev
```

RHEL, AlmaLinux, Rocky Linux and Oracle Linux:

```sh
sudo dnf install redhat-rpm-config gcc make git tar clang-devel pcre2-devel openssl-devel zlib-devel
```

`redhat-rpm-config` provides the compiler specs that nginx.org's RPM builds pass to
the compiler. Without it, `./configure` stops with
`the invalid value in --with-ld-opt="-Wl,-z,relro -Wl,-z,now -pie"`.

On other systems, install the same things with the system's package manager: a C
compiler and make, git, curl, libclang, and the PCRE2, OpenSSL and zlib development
headers.

## Install Rust

ngx_mbrotli needs Rust 1.89 or newer. Distribution packages are often older: Debian 13
ships 1.85. Install Rust with [rustup](https://rustup.rs) as the user who will build:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
```

## Configure nginx's source like your nginx

Download the source of exactly the version you run and configure it with the
arguments your binary was built with. Only `./configure` is needed: the module reads
its output in `objs/`, and nothing is compiled or installed.

```sh
ver=$(nginx -v 2>&1 | sed 's|.*nginx/||')
cd ~
curl -O "https://nginx.org/download/nginx-$ver.tar.gz"
tar xzf "nginx-$ver.tar.gz"
cd "nginx-$ver"
eval "./configure $(nginx -V 2>&1 | sed -n 's/^configure arguments: //p')"
```

`eval` keeps quoted arguments such as `--with-cc-opt='-O2 -g ...'` in one piece. If
`./configure` reports a missing library, install its development package and run it
again.

## Build the module

```sh
cd ~
git clone --depth 1 --branch v0.4.5 https://github.com/M-Compressors/ngx_mbrotli
cd ngx_mbrotli
NGINX_BUILD_DIR="$HOME/nginx-$ver/objs" cargo build --release
```

`v0.4.5` is the latest release at the time of writing; the
[release page](https://github.com/M-Compressors/ngx_mbrotli/releases) lists newer
ones. The module is written to `target/release/libngx_mbrotli.so`. It contains the
mbrotli encoder, so no brotli C library is needed.

## Install and load it

Copy the module into nginx's modules directory, which `nginx -V` shows as
`--modules-path`:

```sh
moddir=$(nginx -V 2>&1 | grep -o -- '--modules-path=[^ ]*' | cut -d= -f2)
sudo install -m 644 target/release/libngx_mbrotli.so "$moddir/"
```

Load it at the very top of `/etc/nginx/nginx.conf`:

```nginx
load_module modules/libngx_mbrotli.so;
```

Turn compression on as in the
[previous post](/2026/install-ngx-mbrotli-packages/#turn-compression-on), then check
and restart:

```sh
sudo nginx -t
sudo systemctl restart nginx
curl -sS -o /dev/null -D - -H 'Accept-Encoding: br' http://localhost/ | grep -i content-encoding
```

## Building nginx too

To build nginx yourself instead of installing it from nginx.org, configure it with
`--with-compat`. This builds nginx 1.30.6 into `/usr/local/nginx` on Ubuntu 24.04,
with the build tools from above installed:

```sh
cd ~
curl -O https://nginx.org/download/nginx-1.30.6.tar.gz
tar xzf nginx-1.30.6.tar.gz
cd nginx-1.30.6
./configure --prefix=/usr/local/nginx --with-compat --with-threads \
    --with-http_ssl_module --with-http_v2_module
make -j"$(nproc)"
sudo make install
```

`--with-threads` lets the module compress on thread pools. Build ngx_mbrotli against
this tree with `NGINX_BUILD_DIR="$HOME/nginx-1.30.6/objs"` as above, copy
`libngx_mbrotli.so` to `/usr/local/nginx/modules/`, and load it with
`load_module modules/libngx_mbrotli.so;`.

## When nginx is upgraded

A module built for one nginx version does not load into another, so after every
nginx upgrade, download the new version's source, configure it, build the module
again and restart nginx. A reload is not enough: the master process keeps the old
module loaded.

## Errors you may see

| Error | Cause | Fix |
|---|---|---|
| `module "…" is not binary compatible` | The source was configured differently from the running nginx, or that nginx lacks `--with-compat`. | Configure with exactly the arguments from `nginx -V`, with nginx from nginx.org or built with `--with-compat`. |
| `module "…" version 1030005 instead of 1030006` | The module was built against another nginx version. | Build against the source of the version you run. |
| `module "ngx_http_brotli_filter_module" is already loaded` | google/ngx_brotli is still loaded; the modules have the same names. | Remove its `load_module` line or package. |
| `the invalid value in --with-ld-opt` on RHEL | The compiler specs used by nginx.org's RPM builds are missing. | Install `redhat-rpm-config`. |
| `Unable to find libclang` during `cargo build` | libclang is not installed. | Install `libclang-dev` or `clang-devel`. |

To add Zstandard as well, [build ngx_mzstd](/2026/build-ngx-mzstd-from-source/) the
same way against the same nginx source.
