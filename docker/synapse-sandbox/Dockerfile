FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    file \
    findutils \
    gawk \
    git \
    grep \
    jq \
    less \
    procps \
    python3 \
    python3-pip \
    ripgrep \
    sed \
    tar \
    tree \
    unzip \
    wget \
    zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["/bin/bash"]
