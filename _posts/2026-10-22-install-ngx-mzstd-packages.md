---
title: "Installing Zstandard for NGINX from packages: ngx_mzstd"
description: >-
  How to install the ngx_mzstd Zstandard module with apt or dnf on Debian, Ubuntu,
  RHEL, AlmaLinux, Rocky Linux and Amazon Linux, for nginx.org's nginx and for the
  distribution's own.
date: 2026-10-22 09:30:00 +0300
image: /assets/img/og/install-ngx-mzstd-packages.png
projects: [ngx_mzstd]
tags: [nginx, zstd, zstandard, linux, debian, ubuntu, rhel]
summary:
  - "Prebuilt **ngx_mzstd** packages exist for amd64 and arm64, for nginx.org stable and mainline and for the nginx shipped by Debian 13, Ubuntu 26.04 and RHEL 10."
  - "With nginx.org's nginx the package is `nginx-module-mzstd` and needs a `load_module` line; the distribution packages enable themselves."
  - "ngx_mzstd is a drop-in replacement for tokers/zstd-nginx-module: the same directives, defaults and variable. It does not need the zstd C library."
  - "With ngx_mbrotli loaded too, nginx answers `Content-Encoding: zstd` to clients that accept both, in either `load_module` order."
  - "Each package is built against one exact nginx package, so the module and nginx are upgraded together. Restart nginx after an upgrade, not just reload."
faq:
  - q: Which ngx_mzstd package do I need?
    a: >-
      With nginx from nginx.org, `nginx-module-mzstd`. With Debian's or Ubuntu's own
      nginx, `libnginx-mod-http-mzstd`. With the nginx of RHEL 10, AlmaLinux 10 or
      Rocky Linux 10, `nginx-mod-mzstd`.
  - q: Do I need a load_module line after installing the package?
    a: >-
      Only with nginx.org's nginx: add `load_module modules/ngx_mzstd.so;` at the top
      of `/etc/nginx/nginx.conf`. The packages for the distributions' own nginx
      install a configuration file that loads the module.
  - q: Which encoding wins when both Brotli and Zstandard modules are loaded?
    a: >-
      Zstandard. When a client accepts both, nginx answers with
      `Content-Encoding: zstd`, whatever order ngx_mbrotli and ngx_mzstd are loaded in.
  - q: Can I keep my tokers/zstd-nginx-module configuration?
    a: >-
      Yes. ngx_mzstd has the same directives and defaults. Remove the old module's
      packages and `load_module` lines first: the packages conflict, and nginx refuses
      to load two modules with the same name.
  - q: Is reload enough after upgrading the module package?
    a: >-
      No. The nginx master process keeps the old `.so` loaded across a reload, so run
      `sudo systemctl restart nginx`.
---

**ngx_mzstd** adds Zstandard compression to NGINX. It is a drop-in replacement for
tokers/zstd-nginx-module, written in Rust on top of the
[mzstd](https://github.com/M-Compressors/mzstd) encoder, so it needs no zstd C
library, and it can compress on NGINX thread pools. This post installs it from
packages. If there is no package for your system,
[build it from source](/2026/build-ngx-mzstd-from-source/).

Every command below was run on 22 October 2026 on fresh containers of Debian 13 and
AlmaLinux 10 with their own nginx, and of Ubuntu 24.04, Rocky Linux 9 and Amazon
Linux 2023 with nginx.org's nginx. Each one ended with nginx answering `Content-Encoding: zstd`.

## Find out which nginx you run

Each module package is built against one exact nginx package, so the package to
install depends on where your nginx came from:

```sh
nginx -v
apt-cache policy nginx    # Debian, Ubuntu
rpm -q nginx              # RHEL and derivatives, Amazon Linux
```

nginx.org's packages have versions like `1.30.6-1~noble` on Debian and Ubuntu and
end in `.ngx` on RPM systems, as in `nginx-1.30.6-1.el9.ngx`. Anything else is the
distribution's own nginx.

| System | nginx from | Package |
|---|---|---|
| Debian 12, 13; Ubuntu 22.04, 24.04, 26.04 | nginx.org | `nginx-module-mzstd` |
| Debian 13, Ubuntu 26.04 | the distribution | `libnginx-mod-http-mzstd` |
| RHEL, AlmaLinux, Rocky Linux, Oracle Linux 8–10; Amazon Linux 2023 | nginx.org | `nginx-module-mzstd` |
| RHEL, AlmaLinux, Rocky Linux 10 | the distribution | `nginx-mod-mzstd` |

All packages are built for amd64 and arm64. The module needs nginx 1.25.4 or newer,
which rules out the nginx that Debian 12, Ubuntu 22.04 and 24.04, and RHEL 8 and 9
ship: on those systems, install nginx from nginx.org as shown below.

## Debian and Ubuntu with nginx.org's nginx

If nginx is not from nginx.org yet, add its repository first. These are
[nginx.org's instructions](https://nginx.org/en/linux_packages.html) for Ubuntu; on
Debian, replace `ubuntu-keyring` with `debian-archive-keyring` and `ubuntu` in the
URL with `debian`.

```sh
sudo apt install curl gnupg2 ca-certificates lsb-release ubuntu-keyring
curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor \
    | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
https://nginx.org/packages/ubuntu `lsb_release -cs` nginx" \
    | sudo tee /etc/apt/sources.list.d/nginx.list
printf "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" \
    | sudo tee /etc/apt/preferences.d/99nginx
sudo apt update
sudo apt install nginx
```

Then add the module repository and install the module:

```sh
curl -1sLf 'https://dl.cloudsmith.io/public/m-compressors/ngx_mzstd/setup.deb.sh' | sudo -E bash
sudo apt-get install nginx-module-mzstd
```

The setup script comes from [Cloudsmith](https://cloudsmith.io/~m-compressors/repos/),
which hosts the repository. It adds the repository's signing key and an apt source;
download it and read it first if you prefer.

Like nginx.org's own `nginx-module-*` packages, this one installs the module without
enabling it. Add this line to the very top of `/etc/nginx/nginx.conf`:

```nginx
load_module modules/ngx_mzstd.so;
```

## Debian 13 and Ubuntu 26.04 with their own nginx

```sh
sudo apt-get install nginx
curl -1sLf 'https://dl.cloudsmith.io/public/m-compressors/ngx_mzstd/setup.deb.sh' | sudo -E bash
sudo apt-get install libnginx-mod-http-mzstd
```

As with Debian's own module packages, the module is enabled on installation through
`/etc/nginx/modules-enabled/`, so there is no `load_module` line to add.

## RHEL, AlmaLinux, Rocky Linux and Amazon Linux with nginx.org's nginx

If nginx is not from nginx.org yet, create `/etc/yum.repos.d/nginx.repo`:

```ini
[nginx-stable]
name=nginx stable repo
baseurl=https://nginx.org/packages/centos/$releasever/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
```

On Amazon Linux 2023 the `baseurl` is
`https://nginx.org/packages/amzn/2023/$basearch/`, and nginx.org also adds
`priority=9`. Then install nginx and the module:

```sh
sudo dnf install nginx
curl -1sLf 'https://dl.cloudsmith.io/public/m-compressors/ngx_mzstd/setup.rpm.sh' | sudo -E bash
sudo dnf install nginx-module-mzstd
```

dnf asks you to accept the repository's signing key. Add the `load_module` line to
the top of `/etc/nginx/nginx.conf`:

```nginx
load_module modules/ngx_mzstd.so;
```

## RHEL 10 with its own nginx

This covers the default AppStream nginx on RHEL 10, AlmaLinux 10 and Rocky Linux 10:

```sh
sudo dnf install nginx
curl -1sLf 'https://dl.cloudsmith.io/public/m-compressors/ngx_mzstd/setup.rpm.sh' | sudo -E bash
sudo dnf install nginx-mod-mzstd
```

The package enables the module through `/usr/share/nginx/modules/mod-mzstd.conf`,
which the stock `nginx.conf` includes.

## nginx.org mainline

For nginx.org's mainline nginx, use the `ngx_mzstd-mainline` repository. The
package name stays the same:

```sh
curl -1sLf 'https://dl.cloudsmith.io/public/m-compressors/ngx_mzstd-mainline/setup.deb.sh' | sudo -E bash
```

Use `setup.rpm.sh` instead of `setup.deb.sh` on RPM systems.

## Turn compression on

The module does nothing until compression is switched on. Put this in
`/etc/nginx/conf.d/zstd.conf`, which every nginx above includes inside `http`:

```nginx
zstd on;
zstd_comp_level 3;
zstd_types text/plain text/css application/javascript application/json image/svg+xml;
```

`text/html` is compressed by default and does not need to be listed. Check the
configuration, restart nginx and ask for Zstandard:

```sh
sudo nginx -t
sudo systemctl restart nginx
curl -sS -o /dev/null -D - -H 'Accept-Encoding: zstd' http://localhost/ | grep -i content-encoding
```

The answer is `Content-Encoding: zstd`. If you also run
[ngx_mbrotli](/2026/install-ngx-mbrotli-packages/), a browser that accepts both gets
Zstandard, in either `load_module` order.

To keep large responses from blocking other requests, the module can compress on a
thread pool with `zstd_thread_pool default;`. This needs nginx built with
`--with-threads`, which `nginx -V` shows. The
[ngx_mzstd README](https://github.com/M-Compressors/ngx_mzstd#benchmarks) has the
numbers and the trade-offs, including the extra memory a pool needs.

## Upgrades

The module package requires the exact nginx package it was built for, so nginx and
the module are upgraded together. The version shows the pairing: nginx.org packages
put nginx first, as in `1.30.6+0.2.3`, and the distribution packages put the module
first, as in `0.2.3+1.26.3`.

After an upgrade, **restart** nginx rather than reloading it. A reload keeps the
master process, and the master keeps the old module loaded.

## Moving from tokers/zstd-nginx-module

Existing `zstd*` directives keep working unchanged. The packages conflict with the
old module's, such as `nginx-module-zstd`, so remove those first. Also
delete any `load_module` lines that load the old `.so` files: the old and new
modules have the same names, and nginx refuses to load a module name twice.
