#!/bin/bash
# ============================================
# NullName DB - Installation Script
# No brand. No name. No payment.
# Version: 2.0.0
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
INSTALL_DIR="/opt/nullname"
DATA_DIR="/var/lib/nullname"
LOG_DIR="/var/log/nullname"
CONFIG_DIR="/etc/nullname"
SERVICE_NAME="nullname"
NODE_VERSION="18"
NODE_MIN_VERSION="18.0.0"

# Default values
DEFAULT_PORT="3000"
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASS="nullname2025"
DEFAULT_DOMAIN="localhost"

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                                              ║${NC}"
    echo -e "${CYAN}║   NullName DB Installation Script v2.0                       ║${NC}"
    echo -e "${CYAN}║   No brand. No name. No payment.                             ║${NC}"
    echo -e "${CYAN}║                                                              ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }
print_value() { echo -e "  ${CYAN}${1}:${NC} ${2}"; }

confirm() {
    read -p "$1 (y/N): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# ============================================
# CHECK REQUIREMENTS
# ============================================

check_requirements() {
    print_step "Checking system requirements..."
    
    # OS Check
    OS="$(uname -s)"
    case "$OS" in
        Linux) print_success "OS: Linux" ;;
        Darwin) print_success "OS: macOS" ;;
        *)
            print_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac
    
    # Architecture
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|aarch64|arm64) print_success "Architecture: $ARCH" ;;
        *) print_warning "Architecture: $ARCH (may not be fully tested)" ;;
    esac
    
    # Disk Space
    if command -v df &> /dev/null; then
        AVAILABLE_SPACE=$(df "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
        if [ "$AVAILABLE_SPACE" -lt 512000 ] 2>/dev/null; then
            print_warning "Low disk space. 500MB minimum recommended."
        else
            print_success "Disk space: sufficient"
        fi
    fi
    
    # Memory
    if command -v free &> /dev/null; then
        TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
        if [ "$TOTAL_MEM" -lt 512 ]; then
            print_warning "Low memory: ${TOTAL_MB}MB (512MB+ recommended)"
        else
            print_success "Memory: ${TOTAL_MEM}MB"
        fi
    fi
    
    # Root/Sudo check
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root. It's recommended to run as a regular user with sudo."
    fi
}

# ============================================
# NODE.JS INSTALLATION
# ============================================

check_nodejs() {
    print_step "Checking Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION_INSTALLED=$(node -v | cut -d'v' -f2)
        print_success "Node.js found: v$NODE_VERSION_INSTALLED"
        
        if version_ge "$NODE_VERSION_INSTALLED" "$NODE_MIN_VERSION"; then
            print_success "Node.js version meets requirements (>= $NODE_MIN_VERSION)"
            return 0
        else
            print_warning "Node.js version $NODE_VERSION_INSTALLED is older than required $NODE_MIN_VERSION"
            return 1
        fi
    else
        print_info "Node.js not found."
        return 1
    fi
}

install_nodejs() {
    print_step "Installing Node.js..."
    
    if command -v apt-get &> /dev/null; then
        print_info "Detected apt package manager (Debian/Ubuntu)"
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        print_info "Detected yum package manager (RHEL/CentOS)"
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v dnf &> /dev/null; then
        print_info "Detected dnf package manager (Fedora)"
        sudo dnf install -y nodejs
    elif command -v brew &> /dev/null; then
        print_info "Detected Homebrew (macOS)"
        brew install node@${NODE_VERSION}
        brew link --force node@${NODE_VERSION}
    else
        print_error "Could not install Node.js automatically. Please install Node.js $NODE_VERSION+ manually."
        exit 1
    fi
    
    if command -v node &> /dev/null; then
        print_success "Node.js installed: $(node -v)"
    else
        print_error "Node.js installation failed"
        exit 1
    fi
}

# ============================================
# DEPENDENCIES
# ============================================

check_git() {
    print_step "Checking git..."
    
    if ! command -v git &> /dev/null; then
        print_info "git not found. Installing..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get install -y git
        elif command -v yum &> /dev/null; then
            sudo yum install -y git
        elif command -v brew &> /dev/null; then
            brew install git
        else
            print_error "Could not install git automatically. Please install git manually."
            exit 1
        fi
    fi
    print_success "git available: $(git --version)"
}

check_curl() {
    if ! command -v curl &> /dev/null; then
        print_info "curl not found. Installing..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get install -y curl
        elif command -v yum &> /dev/null; then
            sudo yum install -y curl
        elif command -v brew &> /dev/null; then
            brew install curl
        fi
    fi
}

# ============================================
# CONFIGURATION COLLECTION
# ============================================

collect_configuration() {
    print_step "Configuration"
    echo ""
    
    # Domain
    read -p "Enter domain (default: $DEFAULT_DOMAIN): " DOMAIN
    DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
    
    # Port
    read -p "Enter port (default: $DEFAULT_PORT): " PORT
    PORT=${PORT:-$DEFAULT_PORT}
    
    # Admin User
    read -p "Enter admin username (default: $DEFAULT_ADMIN_USER): " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-$DEFAULT_ADMIN_USER}
    
    # Admin Password
    echo -n "Enter admin password (default: $DEFAULT_ADMIN_PASS): "
    read -s ADMIN_PASS
    echo ""
    ADMIN_PASS=${ADMIN_PASS:-$DEFAULT_ADMIN_PASS}
    
    # SSL
    read -p "Enable HTTPS/SSL? (y/n): " ENABLE_SSL_INPUT
    ENABLE_SSL="false"
    SSL_CERT_PATH=""
    SSL_KEY_PATH=""
    
    if [[ $ENABLE_SSL_INPUT =~ ^[Yy]$ ]]; then
        ENABLE_SSL="true"
        read -p "SSL certificate path: " SSL_CERT_PATH
        read -p "SSL private key path: " SSL_KEY_PATH
    fi
    
    # Auto Backup
    read -p "Enable automatic backups? (y/n, default y): " AUTO_BACKUP_INPUT
    if [[ $AUTO_BACKUP_INPUT =~ ^[Nn]$ ]]; then
        BACKUP_ENABLED="false"
    else
        BACKUP_ENABLED="true"
    fi
    
    # Backup Interval
    if [ "$BACKUP_ENABLED" = "true" ]; then
        read -p "Backup interval in hours (default: 24): " BACKUP_INTERVAL
        BACKUP_INTERVAL=${BACKUP_INTERVAL:-24}
    else
        BACKUP_INTERVAL=0
    fi
    
    echo ""
    echo -e "${CYAN}Configuration summary:${NC}"
    echo "  ┌─────────────────────────────────────────────"
    print_value "Domain" "$DOMAIN"
    print_value "Port" "$PORT"
    print_value "Admin User" "$ADMIN_USER"
    print_value "HTTPS Enabled" "$ENABLE_SSL"
    print_value "Auto Backup" "$BACKUP_ENABLED"
    [ "$BACKUP_ENABLED" = "true" ] && print_value "Backup Interval" "$BACKUP_INTERVAL hours"
    echo "  └─────────────────────────────────────────────"
    echo ""
    
    if ! confirm "Proceed with installation?"; then
        echo "Installation cancelled."
        exit 0
    fi
}

# ============================================
# DIRECTORY SETUP
# ============================================

create_directories() {
    print_step "Creating directories..."
    
    # Main directories
    sudo mkdir -p "$INSTALL_DIR"
    sudo mkdir -p "$DATA_DIR"
    sudo mkdir -p "$LOG_DIR"
    sudo mkdir -p "$CONFIG_DIR"
    
    # Subdirectories
    sudo mkdir -p "$INSTALL_DIR/database"/{sql,nosql,filebase,files,commits,branches,backups,timeline,temp,cache,logs,track}
    sudo mkdir -p "$INSTALL_DIR/studio"
    sudo mkdir -p "$INSTALL_DIR/cli"
    sudo mkdir -p "$INSTALL_DIR/ui"
    sudo mkdir -p "$INSTALL_DIR/docs"
    sudo mkdir -p "$INSTALL_DIR/core"
    
    # Set permissions
    sudo chown -R $(whoami):$(whoami) "$INSTALL_DIR" 2>/dev/null || true
    sudo chmod -R 755 "$INSTALL_DIR"
    
    print_success "Directories created"
}

# ============================================
# FILE SETUP
# ============================================

generate_env() {
    print_step "Generating configuration..."
    
    ROOT_KEY=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
    
    cat > "$INSTALL_DIR/.env" << EOF
# NullName DB Environment Configuration
# Generated: $(date)

# Server
PORT=$PORT
DOMAIN=$DOMAIN
NODE_ENV=production

# Authentication
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
ROOT_KEY=$ROOT_KEY
SESSION_SECRET=$SESSION_SECRET
SESSION_TIMEOUT=86400000

# SSL/TLS
ENABLE_SSL=$ENABLE_SSL
SSL_CERT_PATH=$SSL_CERT_PATH
SSL_KEY_PATH=$SSL_KEY_PATH

# Storage
MAX_FILE_SIZE_MB=50
MAX_STORAGE_MB=10240
TEMP_FILE_CLEANUP_MS=3600000

# Backup
ENABLE_BACKUP=$BACKUP_ENABLED
BACKUP_INTERVAL_HOURS=$BACKUP_INTERVAL
MAX_BACKUPS_KEEP=10

# Logging
LOG_LEVEL=info
SLOW_QUERY_MS=1000

# Features
ENABLE_SIGNUP=true
ENABLE_PUBLIC_READ=false
ENABLE_FILE_UPLOADS=true
ENABLE_VERSION_CONTROL=true
ENABLE_REALTIME=true
ENABLE_SQL=true
ENABLE_NOSQL=true
ENABLE_FILEBASE=true

# Rate Limiting
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW_MS=900000

# Session
SESSION_TIMEOUT=86400000
MAX_SESSIONS_PER_USER=10
EOF
    
    print_success ".env created"
}

generate_package_json() {
    cat > "$INSTALL_DIR/package.json" << 'EOF'
{
  "name": "nullname-db",
  "version": "2.0.0",
  "description": "NullName DB - No brand. No name. No payment. The simplest database in the universe.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "production": "NODE_ENV=production node server.js",
    "install": "bash installment/install.sh",
    "uninstall": "bash installment/uninstall.sh",
    "config": "bash installment/config.sh",
    "status": "node server.js --status",
    "backup": "node scripts/backup.js",
    "restore": "node scripts/restore.js",
    "clean": "node scripts/cleanup.js"
  },
  "keywords": ["database", "json", "nosql", "simple", "free", "nullname", "zero-config", "rest-api", "version-control"],
  "author": "NullName Community",
  "license": "MIT",
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "uuid": "^9.0.1",
    "fs-extra": "^11.1.1",
    "dotenv": "^16.3.1",
    "multer": "^1.4.5-lts.1",
    "compression": "^1.7.4",
    "helmet": "^7.0.0",
    "express-rate-limit": "^6.10.0",
    "ws": "^8.14.2",
    "archiver": "^6.0.1",
    "decompress": "^4.2.1",
    "mime-types": "^2.1.35",
    "sharp": "^0.33.1"
  },
  "devDependencies": { "nodemon": "^3.0.1" }
}
EOF
    print_success "package.json created"
}

copy_source_files() {
    print_step "Copying source files..."
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    # Core server files
    for file in server.js queries.js auth.js user.js internet.js; do
        if [ -f "$PROJECT_DIR/$file" ]; then
            cp "$PROJECT_DIR/$file" "$INSTALL_DIR/"
            print_success "Copied: $file"
        else
            print_warning "File not found: $file"
        fi
    done
    
    # Core modules
    if [ -d "$PROJECT_DIR/core" ]; then
        cp -r "$PROJECT_DIR/core" "$INSTALL_DIR/"
        print_success "Copied: core/"
    else
        mkdir -p "$INSTALL_DIR/core"
        print_warning "core/ not found, created empty"
    fi
    
    # UI files
    if [ -d "$PROJECT_DIR/ui" ]; then
        cp -r "$PROJECT_DIR/ui" "$INSTALL_DIR/"
        print_success "Copied: ui/"
    else
        mkdir -p "$INSTALL_DIR/ui"
        print_warning "ui/ not found, created empty"
    fi
    
    # Studio files
    if [ -d "$PROJECT_DIR/studio" ]; then
        cp -r "$PROJECT_DIR/studio" "$INSTALL_DIR/"
        print_success "Copied: studio/"
    else
        mkdir -p "$INSTALL_DIR/studio"
        print_warning "studio/ not found, created empty"
    fi
    
    # CLI files
    if [ -d "$PROJECT_DIR/cli" ]; then
        cp -r "$PROJECT_DIR/cli" "$INSTALL_DIR/"
        print_success "Copied: cli/"
    else
        mkdir -p "$INSTALL_DIR/cli"
        print_warning "cli/ not found, created empty"
    fi
    
    # Documentation
    if [ -d "$PROJECT_DIR/docs" ]; then
        cp -r "$PROJECT_DIR/docs" "$INSTALL_DIR/"
        print_success "Copied: docs/"
    else
        mkdir -p "$INSTALL_DIR/docs"
        print_warning "docs/ not found, created empty"
    fi
}

install_dependencies() {
    print_step "Installing npm dependencies..."
    
    cd "$INSTALL_DIR"
    npm install --production --no-audit --no-fund 2>/dev/null || {
        print_warning "Production install failed, trying with dev dependencies..."
        npm install --no-audit --no-fund
    }
    
    print_success "Dependencies installed"
}

# ============================================
# SERVICE SETUP
# ============================================

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
Environment=NODE_OPTIONS="--max-old-space-size=512"

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    print_success "Systemd service created"
}

create_launchd_service() {
    print_step "Creating launchd service (macOS)..."
    
    PLIST_PATH="$HOME/Library/LaunchAgents/com.nullname.db.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nullname.db</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$INSTALL_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/access.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/error.log</string>
</dict>
</plist>
EOF
    
    launchctl load "$PLIST_PATH"
    print_success "Launchd service created"
}

create_uninstall_script() {
    cat > "$INSTALL_DIR/uninstall.sh" << 'EOF'
#!/bin/bash
echo "⚠️  WARNING: This will DELETE ALL NullName DB data!"
read -p "Type 'DELETE' to confirm: " CONFIRM
[ "$CONFIRM" != "DELETE" ] && echo "Cancelled." && exit 0

sudo systemctl stop nullname 2>/dev/null || true
sudo systemctl disable nullname 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.nullname.db.plist 2>/dev/null || true

sudo rm -rf /opt/nullname /var/lib/nullname /var/log/nullname /etc/nullname
sudo rm /etc/systemd/system/nullname.service 2>/dev/null || true
rm ~/Library/LaunchAgents/com.nullname.db.plist 2>/dev/null || true

sudo systemctl daemon-reload 2>/dev/null || true
echo "✅ NullName DB uninstalled completely!"
EOF
    chmod +x "$INSTALL_DIR/uninstall.sh"
}

# ============================================
# START SERVICE
# ============================================

start_service() {
    print_step "Starting NullName DB service..."
    
    if command -v systemctl &> /dev/null; then
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
    elif command -v launchctl &> /dev/null; then
        launchctl load "$HOME/Library/LaunchAgents/com.nullname.db.plist"
        print_success "Launchd service loaded"
    else
        print_warning "No service manager found. Starting directly..."
        cd "$INSTALL_DIR"
        nohup node server.js > "$LOG_DIR/output.log" 2>&1 &
        print_success "Process started with PID: $!"
    fi
}

# ============================================
# FINAL OUTPUT
# ============================================

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   NullName DB Successfully Installed!                        ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}📍 Access URLs:${NC}"
    echo "   Dashboard: http://$DOMAIN:$PORT/studio"
    echo "   API: http://$DOMAIN:$PORT/q?=your_query"
    echo "   CLI: http://$DOMAIN:$PORT/cli"
    echo ""
    echo -e "${CYAN}🔐 Admin Credentials:${NC}"
    echo "   Username: $ADMIN_USER"
    echo "   Password: [hidden]"
    echo ""
    echo -e "${CYAN}🛠️  Service Management:${NC}"
    if command -v systemctl &> /dev/null; then
        echo "   Start:   sudo systemctl start $SERVICE_NAME"
        echo "   Stop:    sudo systemctl stop $SERVICE_NAME"
        echo "   Restart: sudo systemctl restart $SERVICE_NAME"
        echo "   Status:  sudo systemctl status $SERVICE_NAME"
        echo "   Logs:    sudo journalctl -u $SERVICE_NAME -f"
    else
        echo "   Start:   cd $INSTALL_DIR && node server.js"
        echo "   Stop:    pkill -f 'node server.js'"
    fi
    echo ""
    echo -e "${CYAN}🗑️  Uninstall:${NC}"
    echo "   sudo bash $INSTALL_DIR/uninstall.sh"
    echo ""
    echo -e "${CYAN}📁 Directories:${NC}"
    echo "   Installation: $INSTALL_DIR"
    echo "   Data: $DATA_DIR"
    echo "   Logs: $LOG_DIR"
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   No brand. No name. No payment.                              ║${NC}"
    echo -e "${CYAN}║   The simplest database in the universe.                      ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================
# MAIN
# ============================================

main() {
    print_header
    
    # Check if already installed
    if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
        print_warning "NullName DB already installed at $INSTALL_DIR"
        if ! confirm "Reinstall/overwrite?"; then
            echo "Installation cancelled."
            exit 0
        fi
    fi
    
    # Run installation steps
    check_requirements
    if ! check_nodejs; then
        install_nodejs
    fi
    check_git
    check_curl
    collect_configuration
    create_directories
    generate_env
    generate_package_json
    copy_source_files
    install_dependencies
    
    # Create service
    if command -v systemctl &> /dev/null; then
        create_systemd_service
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        create_launchd_service
    fi
    
    create_uninstall_script
    start_service
    print_summary
}

main "$@"
