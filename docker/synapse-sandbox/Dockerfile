FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    file \
    findutils \
    gawk \
    grep \
    less \
    procps \
    python3 \
    python3-pip \
    ripgrep \
    sed \
    tar \
    unzip \
    zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["/bin/bash"]
