FROM alpine:3.24

ARG TARGETARCH=amd64
ARG XRAY_VERSION=26.3.27

RUN apk add --no-cache curl jq bash ca-certificates gettext

# Download and install official Xray-core binary release
RUN mkdir -p /usr/local/bin /etc/xray && \
    ARCH="${TARGETARCH}" && \
    if [ "$ARCH" = "amd64" ]; then XRAY_ARCH="64"; elif [ "$ARCH" = "arm64" ]; then XRAY_ARCH="arm64-v8a"; else XRAY_ARCH="64"; fi && \
    curl -sL "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-${XRAY_ARCH}.zip" -o /tmp/xray.zip && \
    unzip -q /tmp/xray.zip -d /tmp/xray && \
    mv /tmp/xray/xray /usr/local/bin/xray && \
    chmod +x /usr/local/bin/xray && \
    rm -rf /tmp/xray*

WORKDIR /etc/xray

COPY config.template.json /etc/xray/config.template.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
