#!/bin/bash
# ============================================
# NullName DB - Installation Script
# No brand. No name. No payment.
# Version: 1.0.0
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

INSTALL_DIR="/opt/nullname"
DATA_DIR="/var/lib/nullname"
LOG_DIR="/var/log/nullname"
SERVICE_NAME="nullname"
NODE_VERSION="18"

DEFAULT_PORT="3000"
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASS="nullname2025"

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   NullName DB Installation Script${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }

confirm() { read -p "$1 (y/N): " -n 1 -r; echo ""; [[ $REPLY =~ ^[Yy]$ ]]; }

check_requirements() {
    print_step "Checking system requirements..."
    OS="$(uname -s)"
    case "$OS" in Linux) print_success "OS: Linux" ;; Darwin) print_success "OS: macOS" ;; *) print_error "Unsupported OS: $OS"; exit 1;; esac
    AVAILABLE_SPACE=$(df "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
    if [ "$AVAILABLE_SPACE" -lt 512000 ] 2>/dev/null; then print_warning "Low disk space. 500MB minimum recommended."; else print_success "Disk space: sufficient"; fi
}

check_nodejs() {
    print_step "Checking Node.js..."
    if command -v node &> /dev/null; then
        NODE_VERSION_INSTALLED=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        print_success "Node.js found: v$(node -v)"
        if [ "$NODE_VERSION_INSTALLED" -lt "$NODE_VERSION" ]; then print_warning "Node.js $NODE_VERSION+ recommended"; fi
        return 0
    else
        print_info "Node.js not found. Installing..."
        return 1
    fi
}

install_nodejs() {
    print_step "Installing Node.js..."
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v brew &> /dev/null; then
        brew install node@${NODE_VERSION}
    else
        print_error "Could not install Node.js. Please install manually."
        exit 1
    fi
    print_success "Node.js installed: $(node -v)"
}

check_git() {
    print_step "Checking git..."
    if ! command -v git &> /dev/null; then
        print_info "git not found. Installing..."
        if command -v apt-get &> /dev/null; then sudo apt-get install -y git
        elif command -v yum &> /dev/null; then sudo yum install -y git
        elif command -v brew &> /dev/null; then brew install git; fi
    fi
    print_success "git available"
}

collect_input() {
    print_step "Configuration"
    echo ""
    read -p "Enter domain (e.g., db.example.com or localhost): " DOMAIN
    [ -z "$DOMAIN" ] && DOMAIN="localhost" && print_info "Using default domain: $DOMAIN"
    read -p "Enter port (default: $DEFAULT_PORT): " PORT
    [ -z "$PORT" ] && PORT="$DEFAULT_PORT"
    read -p "Enter admin username (default: $DEFAULT_ADMIN_USER): " ADMIN_USER
    [ -z "$ADMIN_USER" ] && ADMIN_USER="$DEFAULT_ADMIN_USER"
    echo -n "Enter admin password (default: $DEFAULT_ADMIN_PASS): "
    read -s ADMIN_PASS
    echo ""
    [ -z "$ADMIN_PASS" ] && ADMIN_PASS="$DEFAULT_ADMIN_PASS" && print_warning "Using default password. Change it after installation!"
    read -p "Enable HTTPS/SSL? (y/n): " ENABLE_SSL
    SSL_ENABLED="false"
    if [[ $ENABLE_SSL =~ ^[Yy]$ ]]; then
        SSL_ENABLED="true"
        read -p "SSL certificate path: " SSL_CERT_PATH
        read -p "SSL private key path: " SSL_KEY_PATH
    fi
    read -p "Enable auto backups? (y/n, default y): " AUTO_BACKUP
    [ -z "$AUTO_BACKUP" ] && AUTO_BACKUP="y"
    BACKUP_ENABLED="true"
    [[ $AUTO_BACKUP =~ ^[Nn]$ ]] && BACKUP_ENABLED="false"
    echo ""
    echo -e "${CYAN}Configuration summary:${NC}"
    echo "  Domain: $DOMAIN"
    echo "  Port: $PORT"
    echo "  Admin: $ADMIN_USER"
    echo "  HTTPS: $SSL_ENABLED"
    echo "  Auto backup: $BACKUP_ENABLED"
    if ! confirm "Proceed with installation?"; then echo "Cancelled."; exit 0; fi
}

create_directories() {
    print_step "Creating directories..."
    sudo mkdir -p "$INSTALL_DIR"/{database,logs,ui,core,docs,installment}
    sudo mkdir -p "$INSTALL_DIR/database"/{path,files,commits,branches,backups,temp,users,logs,track}
    sudo mkdir -p "$DATA_DIR"
    sudo mkdir -p "$LOG_DIR"
    sudo chown -R $(whoami):$(whoami) "$INSTALL_DIR"
    print_success "Directories created"
}

generate_env() {
    print_step "Generating configuration..."
    ROOT_KEY=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
    cat > "$INSTALL_DIR/.env" << EOF
PORT=$PORT
DOMAIN=$DOMAIN
NODE_ENV=production
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
ROOT_KEY=$ROOT_KEY
SESSION_TIMEOUT=86400000
ENABLE_SSL=$SSL_ENABLED
SSL_CERT_PATH=$SSL_CERT_PATH
SSL_KEY_PATH=$SSL_KEY_PATH
MAX_FILE_SIZE_MB=50
BACKUP_INTERVAL_HOURS=24
MAX_BACKUPS_KEEP=10
LOG_LEVEL=info
ENABLE_SIGNUP=true
ENABLE_PUBLIC_READ=false
ENABLE_FILE_UPLOADS=true
ENABLE_VERSION_CONTROL=true
ENABLE_BACKUP_SYSTEM=$BACKUP_ENABLED
EOF
    print_success ".env created"
}

generate_package_json() {
    cat > "$INSTALL_DIR/package.json" << 'EOF'
{
  "name": "nullname-db",
  "version": "1.0.0",
  "description": "NullName DB - No brand. No name. No payment.",
  "main": "server.js",
  "scripts": { "start": "node server.js", "dev": "nodemon server.js" },
  "dependencies": {
    "express": "^4.18.2", "cors": "^2.8.5", "bcrypt": "^5.1.1",
    "uuid": "^9.0.1", "fs-extra": "^11.1.1", "dotenv": "^16.3.1",
    "multer": "^1.4.5-lts.1", "compression": "^1.7.4", "helmet": "^7.0.0",
    "express-rate-limit": "^6.10.0"
  },
  "devDependencies": { "nodemon": "^3.0.1" },
  "engines": { "node": ">=18.0.0" }
}
EOF
    print_success "package.json created"
}

copy_source_files() {
    print_step "Copying source files..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    for file in server.js queries.js auth.js user.js internet.js; do
        if [ -f "$PROJECT_DIR/$file" ]; then cp "$PROJECT_DIR/$file" "$INSTALL_DIR/"; print_success "Copied: $file"
        else print_warning "File not found: $file"; fi
    done
    for dir in core ui docs; do
        if [ -d "$PROJECT_DIR/$dir" ]; then cp -r "$PROJECT_DIR/$dir" "$INSTALL_DIR/"; print_success "Copied: $dir/"
        else mkdir -p "$INSTALL_DIR/$dir"; print_warning "$dir/ not found, created empty"; fi
    done
}

install_dependencies() {
    print_step "Installing npm dependencies..."
    cd "$INSTALL_DIR"
    npm install --production --no-audit --no-fund
    print_success "Dependencies installed"
}

create_systemd_service() {
    print_step "Creating systemd service..."
    sudo cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=NullName DB - No brand. No name. No payment.
After=network.target

[Service]
Type=simple
User=$(whoami)
Group=$(whoami)
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/access.log
StandardError=append:$LOG_DIR/error.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    print_success "Systemd service created"
}

start_service() {
    print_step "Starting NullName DB service..."
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_success "Service started successfully"
    else
        print_error "Service failed to start"
        sudo journalctl -u "$SERVICE_NAME" -n 20 --no-pager
        exit 1
    fi
}

create_uninstall_script() {
    cat > "$INSTALL_DIR/uninstall.sh" << 'EOF'
#!/bin/bash
echo "WARNING: This will DELETE ALL data!"
read -p "Type 'DELETE' to confirm: " CONFIRM
[ "$CONFIRM" != "DELETE" ] && echo "Cancelled." && exit 0
sudo systemctl stop nullname && sudo systemctl disable nullname
sudo rm -rf /opt/nullname /var/lib/nullname /var/log/nullname
sudo rm /etc/systemd/system/nullname.service
sudo systemctl daemon-reload
echo "Uninstall complete!"
EOF
    chmod +x "$INSTALL_DIR/uninstall.sh"
}

print_summary() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}   NullName DB Successfully Installed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${CYAN}Access URLs:${NC}"
    echo "  Dashboard: http://$DOMAIN:$PORT/dashboard"
    echo "  API: http://$DOMAIN:$PORT/q?=your_query"
    echo ""
    echo -e "${CYAN}Admin Credentials:${NC}"
    echo "  Username: $ADMIN_USER"
    echo "  Password: [hidden]"
    echo ""
    echo -e "${CYAN}Service Management:${NC}"
    echo "  Start:   sudo systemctl start $SERVICE_NAME"
    echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
    echo "  Restart: sudo systemctl restart $SERVICE_NAME"
    echo "  Status:  sudo systemctl status $SERVICE_NAME"
    echo "  Logs:    sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo -e "${CYAN}Uninstall: sudo bash $INSTALL_DIR/uninstall.sh${NC}"
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
}

main() {
    print_header
    if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
        print_warning "NullName DB already installed at $INSTALL_DIR"
        if ! confirm "Reinstall/overwrite?"; then echo "Cancelled."; exit 0; fi
    fi
    check_requirements
    if ! check_nodejs; then install_nodejs; fi
    check_git
    collect_input
    create_directories
    generate_env
    generate_package_json
    copy_source_files
    install_dependencies
    create_systemd_service
    create_uninstall_script
    start_service
    print_summary
}

main "$@"