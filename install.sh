#!/usr/bin/env bash

# LisiLou Portfolio - Proxmox LXC Helper Script
# Run this script on your Proxmox host to create an LXC container with the portfolio

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
CTID="${CTID:-}"
HOSTNAME="${HOSTNAME:-lisilou-portfolio}"
MEMORY="${MEMORY:-512}"
DISK="${DISK:-4}"
CORES="${CORES:-1}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
REPO_URL="https://github.com/jhodgkin/lisilou-portfolio.git"

header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

msg() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

header "LisiLou Photography Portfolio - Proxmox Installer"

# Check if running on Proxmox
if ! command -v pveversion &> /dev/null; then
    error "This script must be run on a Proxmox VE host"
fi

msg "Proxmox VE $(pveversion | cut -d'/' -f2) detected"

# Get next available CTID if not specified
if [ -z "$CTID" ]; then
    CTID=$(pvesh get /cluster/nextid)
    msg "Using next available CTID: $CTID"
fi

# Prompt for configuration
echo ""
read -p "Container ID [$CTID]: " input
CTID="${input:-$CTID}"

read -p "Hostname [$HOSTNAME]: " input
HOSTNAME="${input:-$HOSTNAME}"

read -p "Memory in MB [$MEMORY]: " input
MEMORY="${input:-$MEMORY}"

read -p "Disk size in GB [$DISK]: " input
DISK="${input:-$DISK}"

read -p "CPU cores [$CORES]: " input
CORES="${input:-$CORES}"

read -p "Storage [$STORAGE]: " input
STORAGE="${input:-$STORAGE}"

read -p "Network bridge [$BRIDGE]: " input
BRIDGE="${input:-$BRIDGE}"

echo ""
read -p "Use DHCP for networking? [Y/n]: " use_dhcp
use_dhcp="${use_dhcp:-Y}"

if [[ "${use_dhcp,,}" != "y" ]]; then
    read -p "IP Address (e.g., 192.168.1.100/24): " IP_ADDR
    read -p "Gateway: " GATEWAY
    NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=$IP_ADDR,gw=$GATEWAY"
else
    NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=dhcp"
fi

# Download Debian template if not exists
header "Checking Container Template"
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE_PATH="/var/lib/vz/template/cache/$TEMPLATE"

if [ ! -f "$TEMPLATE_PATH" ]; then
    msg "Downloading Debian 12 template..."
    pveam update
    pveam download $TEMPLATE_STORAGE $TEMPLATE
else
    msg "Template already exists"
fi

# Create container
header "Creating LXC Container"
msg "Creating container $CTID ($HOSTNAME)..."

pct create $CTID "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
    --hostname $HOSTNAME \
    --memory $MEMORY \
    --cores $CORES \
    --rootfs $STORAGE:$DISK \
    --net0 $NET_CONFIG \
    --unprivileged 1 \
    --features nesting=1,keyctl=1 \
    --onboot 1 \
    --start 0

msg "Container created successfully"

# Start container
msg "Starting container..."
pct start $CTID
sleep 5

# Wait for network
msg "Waiting for network..."
for i in {1..30}; do
    if pct exec $CTID -- ping -c 1 google.com &> /dev/null; then
        break
    fi
    sleep 2
done

# Install Docker and setup application
header "Installing Docker & Application"

pct exec $CTID -- bash -c "
    set -e

    echo '[INFO] Updating system...'
    apt-get update
    apt-get upgrade -y

    echo '[INFO] Installing dependencies...'
    apt-get install -y ca-certificates curl gnupg git

    echo '[INFO] Adding Docker repository...'
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list

    echo '[INFO] Installing Docker...'
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    echo '[INFO] Enabling Docker service...'
    systemctl enable docker
    systemctl start docker

    echo '[INFO] Cloning repository...'
    cd /opt
    git clone $REPO_URL
    cd lisilou-portfolio

    echo '[INFO] Creating Docker network...'
    docker network create web || true

    echo '[INFO] Starting application...'
    docker compose up -d

    echo '[INFO] Installation complete!'
"

# Get container IP
header "Installation Complete!"
CONTAINER_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  LisiLou Portfolio has been deployed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BLUE}Container ID:${NC}  $CTID"
echo -e "  ${BLUE}Hostname:${NC}      $HOSTNAME"
echo -e "  ${BLUE}IP Address:${NC}    $CONTAINER_IP"
echo -e "  ${BLUE}Portfolio URL:${NC} http://$CONTAINER_IP:8080"
echo ""
echo -e "  ${YELLOW}Configuration:${NC}"
echo -e "    Edit: /opt/lisilou-portfolio/config/site.json"
echo ""
echo -e "  ${YELLOW}Useful commands (run inside container):${NC}"
echo -e "    pct enter $CTID"
echo -e "    cd /opt/lisilou-portfolio"
echo -e "    docker compose logs -f"
echo -e "    docker compose restart"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
