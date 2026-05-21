#!/bin/bash
# ============================================
# NullName DB - Installation Script
# No brand. No name. No payment.
# Version: 1.0.0
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ============================================
# CONFIGURATION
# ============================================

INSTALL_DIR="/opt/nullname"
DATA_DIR="/var/lib/nullname"
LOG_DIR="/var/log/nullname"
CONFIG_DIR="/etc/nullname"
SERVICE_NAME="nullname"
NODE_VERSION="18"
NPM_VERSION="9"

# Default values
DEFAULT_PORT="3000"
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASS="nullname2025"

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   NullName DB Installation Script${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_step() {
    echo ""
    echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"
}

confirm() {
    read -p "$1 (y/N): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

# ============================================
# CHECK SYSTEM REQUIREMENTS
# ============================================

check_requirements() {
    print_step "Checking system requirements..."
    
    # Check OS
    OS="$(uname -s)"
    case "$OS" in
        Linux)
            print_success "Operating System: Linux"
            ;;
        Darwin)
            print_success "Operating System: macOS"
            ;;
        *)
            print_error "Unsupported operating system: $OS"
            exit 1
            ;;
    esac
    
    # Check architecture
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64|aarch64|arm64)
            print_success "Architecture: $ARCH"
            ;;
        *)
            print_warning "Untested architecture: $ARCH"
            ;;
    esac
    
    # Check disk space (minimum 500MB)
    AVAILABLE_SPACE=$(df "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
    if [ "$AVAILABLE_SPACE" -lt 512000 ] 2>/dev/null; then
        print_warning "Low disk space. Minimum 500MB recommended."
    else
        print_success "Disk space: sufficient"
    fi
    
    # Check memory (minimum 256MB)
    TOTAL_MEM=$(free -m 2>/dev/null | awk 'NR==2 {print $2}' || echo "0")
    if [ "$TOTAL_MEM" -lt 256 ] 2>/dev/null; then
        print_warning "Low memory. 256MB minimum recommended."
    else
        print_success "Memory: ${TOTAL_MEM}MB"
    fi
}

# ============================================
# CHECK AND INSTALL DEPENDENCIES
# ============================================

check_nodejs() {
    print_step "Checking Node.js installation..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION_INSTALLED=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        print_success "Node.js found: v$(node -v)"
        
        if [ "$NODE_VERSION_INSTALLED" -lt "$NODE_VERSION" ]; then
            print_warning "Node.js version $NODE_VERSION or higher recommended"
        fi
        return 0
    else
        print_info "Node.js not found. Installing..."
        return 1
    fi
}

install_nodejs() {
    print_step "Installing Node.js..."
    
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        # RHEL/CentOS
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v brew &> /dev/null; then
        # macOS
        brew install node@${NODE_VERSION}
    else
        print_error "Could not install Node.js. Please install manually."
        exit 1
    fi
    
    if command -v node &> /dev/null; then
        print_success "Node.js installed: $(node -v)"
    else
        print_error "Node.js installation failed"
        exit 1
    fi
}

check_npm() {
    print_step "Checking npm..."
    
    if command -v npm &> /dev/null; then
        print_success "npm found: v$(npm -v)"
        return 0
    else
        print_info "npm not found. Installing..."
        return 1
    fi
}

install_npm() {
    print_step "Installing npm..."
    
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y npm
    elif command -v yum &> /dev/null; then
        sudo yum install -y npm
    elif command -v brew &> /dev/null; then
        brew install npm
    fi
    
    if command -v npm &> /dev/null; then
        print_success "npm installed: v$(npm -v)"
    else
        print_error "npm installation failed"
        exit 1
    fi
}

check_git() {
    print_step "Checking git..."
    
    if command -v git &> /dev/null; then
        print_success "git found: $(git --version)"
        return 0
    else
        print_info "git not found. Installing..."
        return 1
    fi
}

install_git() {
    print_step "Installing git..."
    
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y git
    elif command -v yum &> /dev/null; then
        sudo yum install -y git
    elif command -v brew &> /dev/null; then
        brew install git
    fi
    
    if command -v git &> /dev/null; then
        print_success "git installed: $(git --version)"
    else
        print_error "git installation failed"
        exit 1
    fi
}

check_curl() {
    if ! command -v curl &> /dev/null; then
        print_info "curl not found. Installing..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get install -y curl
        elif command -v yum &> /dev/null; then
            sudo yum install -y curl
        fi
    fi
    print_success "curl available"
}

# ============================================
# CREATE DIRECTORIES
# ============================================

create_directories() {
    print_step "Creating directories..."
    
    # Create installation directory
    sudo mkdir -p "$INSTALL_DIR"
    sudo mkdir -p "$INSTALL_DIR"/{database,logs,ui,core,docs,installment}
    sudo mkdir -p "$INSTALL_DIR/database"/{path,files,commits,branches,backups,temp}
    
    # Create data directory
    sudo mkdir -p "$DATA_DIR"
    
    # Create log directory
    sudo mkdir -p "$LOG_DIR"
    
    # Create config directory
    sudo mkdir -p "$CONFIG_DIR"
    
    # Set permissions
    sudo chown -R $(whoami):$(whoami) "$INSTALL_DIR"
    sudo chown -R $(whoami):$(whoami) "$DATA_DIR" 2>/dev/null || true
    sudo chown -R $(whoami):$(whoami) "$LOG_DIR" 2>/dev/null || true
    
    print_success "Directories created"
}

# ============================================
# COLLECT USER INPUT
# ============================================

collect_input() {
    print_step "Configuration"
    
    echo ""
    echo -e "${CYAN}Please enter your configuration:${NC}"
    echo ""
    
    # Domain
    read -p "Enter domain (e.g., db.example.com or localhost): " DOMAIN
    if [ -z "$DOMAIN" ]; then
        DOMAIN="localhost"
        print_info "Using default domain: $DOMAIN"
    fi
    
    # Port
    read -p "Enter port (default: $DEFAULT_PORT): " PORT
    if [ -z "$PORT" ]; then
        PORT="$DEFAULT_PORT"
    fi
    
    # Admin username
    read -p "Enter admin username (default: $DEFAULT_ADMIN_USER): " ADMIN_USER
    if [ -z "$ADMIN_USER" ]; then
        ADMIN_USER="$DEFAULT_ADMIN_USER"
    fi
    
    # Admin password
    echo -n "Enter admin password (default: $DEFAULT_ADMIN_PASS): "
    read -s ADMIN_PASS
    echo ""
    if [ -z "$ADMIN_PASS" ]; then
        ADMIN_PASS="$DEFAULT_ADMIN_PASS"
        print_warning "Using default password. Please change it after installation!"
    fi
    
    # SSL
    echo ""
    read -p "Enable HTTPS/SSL? (y/n): " ENABLE_SSL
    SSL_ENABLED="false"
    SSL_CERT_PATH=""
    SSL_KEY_PATH=""
    
    if [[ $ENABLE_SSL =~ ^[Yy]$ ]]; then
        SSL_ENABLED="true"
        read -p "Enter SSL certificate path: " SSL_CERT_PATH
        read -p "Enter SSL private key path: " SSL_KEY_PATH
    fi
    
    # Auto backup
    read -p "Enable automatic backups? (y/n, default: y): " AUTO_BACKUP
    if [[ $AUTO_BACKUP =~ ^[Nn]$ ]]; then
        BACKUP_ENABLED="false"
    else
        BACKUP_ENABLED="true"
    fi
    
    echo ""
    echo -e "${CYAN}Configuration summary:${NC}"
    echo "  Domain: $DOMAIN"
    echo "  Port: $PORT"
    echo "  Admin user: $ADMIN_USER"
    echo "  HTTPS: $SSL_ENABLED"
    echo "  Auto backup: $BACKUP_ENABLED"
    echo ""
    
    if ! confirm "Proceed with installation?"; then
        echo "Installation cancelled."
        exit 0
    fi
}

# ============================================
# GENERATE CONFIGURATION FILES
# ============================================

generate_env() {
    print_step "Generating configuration files..."
    
    # Generate random root key
    ROOT_KEY=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
    
    cat > "$INSTALL_DIR/.env" << EOF
# ============================================
# NullName DB - Environment Configuration
# ============================================

# Server Configuration
PORT=$PORT
DOMAIN=$DOMAIN
NODE_ENV=production

# Admin User
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
ROOT_KEY=$ROOT_KEY

# Security
SESSION_TIMEOUT=86400000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# SSL Configuration
ENABLE_SSL=$SSL_ENABLED
SSL_CERT_PATH=$SSL_CERT_PATH
SSL_KEY_PATH=$SSL_KEY_PATH

# File Configuration
MAX_FILE_SIZE_MB=50
TEMP_FILE_CLEANUP_MS=3600000

# Backup Configuration
BACKUP_INTERVAL_HOURS=24
MAX_BACKUPS_KEEP=10
BACKUP_COMPRESSION=true

# Logging
LOG_LEVEL=info
ENABLE_REQUEST_LOG=true
ENABLE_QUERY_TRACKING=true

# Storage
MAX_STORAGE_MB=1024
AUTO_CLEANUP_DAYS=30

# Feature Flags
ENABLE_SIGNUP=true
ENABLE_PUBLIC_READ=true
ENABLE_FILE_UPLOADS=true
ENABLE_VERSION_CONTROL=true
ENABLE_BACKUP_SYSTEM=$BACKUP_ENABLED
EOF
    
    print_success ".env file created"
}

generate_package_json() {
    cat > "$INSTALL_DIR/package.json" << 'EOF'
{
  "name": "nullname-db",
  "version": "1.0.0",
  "description": "NullName DB - No brand. No name. No payment.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "production": "NODE_ENV=production node server.js"
  },
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
    "express-rate-limit": "^6.10.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
    print_success "package.json created"
}

# ============================================
# COPY SOURCE FILES
# ============================================

copy_source_files() {
    print_step "Copying source files..."
    
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    # List of files to copy
    FILES=(
        "server.js"
        "queries.js"
        "auth.js"
        "user.js"
        "internet.js"
    )
    
    for file in "${FILES[@]}"; do
        if [ -f "$PROJECT_DIR/$file" ]; then
            cp "$PROJECT_DIR/$file" "$INSTALL_DIR/"
            print_success "Copied: $file"
        else
            print_warning "File not found: $file (will be created from template)"
        fi
    done
    
    # Copy core directory
    if [ -d "$PROJECT_DIR/core" ]; then
        cp -r "$PROJECT_DIR/core" "$INSTALL_DIR/"
        print_success "Copied: core/"
    else
        mkdir -p "$INSTALL_DIR/core"
        print_warning "core/ directory not found, created empty"
    fi
    
    # Copy ui directory
    if [ -d "$PROJECT_DIR/ui" ]; then
        cp -r "$PROJECT_DIR/ui" "$INSTALL_DIR/"
        print_success "Copied: ui/"
    else
        mkdir -p "$INSTALL_DIR/ui"
        print_warning "ui/ directory not found, created empty"
    fi
    
    # Copy docs directory
    if [ -d "$PROJECT_DIR/docs" ]; then
        cp -r "$PROJECT_DIR/docs" "$INSTALL_DIR/"
        print_success "Copied: docs/"
    else
        mkdir -p "$INSTALL_DIR/docs"
        print_warning "docs/ directory not found, created empty"
    fi
}

# ============================================
# INSTALL DEPENDENCIES
# ============================================

install_dependencies() {
    print_step "Installing npm dependencies..."
    
    cd "$INSTALL_DIR"
    npm install --production --no-audit --no-fund
    
    if [ $? -eq 0 ]; then
        print_success "Dependencies installed"
    else
        print_error "Failed to install dependencies"
        exit 1
    fi
}

# ============================================
# CREATE SYSTEMD SERVICE
# ============================================

create_systemd_service() {
    print_step "Creating systemd service..."
    
    sudo cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=NullName DB - No brand. No name. No payment.
Documentation=https://github.com/nullnamedb
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

# ============================================
# CREATE NGINX CONFIGURATION (Optional)
# ============================================

create_nginx_config() {
    if confirm "Create Nginx reverse proxy configuration?"; then
        print_step "Creating Nginx configuration..."
        
        sudo cat > "/etc/nginx/sites-available/$SERVICE_NAME" << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # File upload size
        client_max_body_size 50M;
    }
}
EOF
        
        if [ -f "/etc/nginx/sites-enabled/$SERVICE_NAME" ]; then
            sudo rm "/etc/nginx/sites-enabled/$SERVICE_NAME"
        fi
        sudo ln -s "/etc/nginx/sites-available/$SERVICE_NAME" "/etc/nginx/sites-enabled/"
        
        sudo nginx -t && sudo systemctl reload nginx
        
        print_success "Nginx configuration created"
    fi
}

# ============================================
# CREATE SSL CERTIFICATE (Optional)
# ============================================

setup_ssl() {
    if [[ $SSL_ENABLED == "true" ]] && confirm "Setup Let's Encrypt SSL certificate?"; then
        print_step "Setting up SSL certificate..."
        
        if command -v certbot &> /dev/null; then
            sudo certbot --nginx -d "$DOMAIN"
            print_success "SSL certificate configured"
        else
            print_info "Certbot not found. Installing..."
            if command -v apt-get &> /dev/null; then
                sudo apt-get install -y certbot python3-certbot-nginx
            elif command -v yum &> /dev/null; then
                sudo yum install -y certbot python3-certbot-nginx
            fi
            sudo certbot --nginx -d "$DOMAIN"
            print_success "SSL certificate configured"
        fi
    fi
}

# ============================================
# START SERVICE
# ============================================

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

# ============================================
# CREATE UNINSTALL SCRIPT
# ============================================

create_uninstall_script() {
    print_step "Creating uninstall script..."
    
    cat > "$INSTALL_DIR/uninstall.sh" << 'EOF'
#!/bin/bash
# NullName DB Uninstaller

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "========================================="
echo "NullName DB Uninstaller"
echo "========================================="
echo ""

echo -e "${RED}WARNING: This will delete ALL data!${NC}"
read -p "Type 'DELETE' to confirm: " CONFIRM

if [ "$CONFIRM" != "DELETE" ]; then
    echo "Cancelled."
    exit 0
fi

echo "Stopping service..."
sudo systemctl stop nullname
sudo systemctl disable nullname

echo "Removing files..."
sudo rm -rf /opt/nullname
sudo rm -rf /var/lib/nullname
sudo rm -rf /var/log/nullname
sudo rm -rf /etc/nullname

echo "Removing service..."
sudo rm /etc/systemd/system/nullname.service
sudo systemctl daemon-reload

echo -e "${GREEN}Uninstall complete!${GREEN}"
EOF
    
    chmod +x "$INSTALL_DIR/uninstall.sh"
    print_success "Uninstall script created"
}

# ============================================
# PRINT INSTALLATION SUMMARY
# ============================================

print_summary() {
    print_step "Installation Complete!"
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}   NullName DB Successfully Installed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${CYAN}Installation Details:${NC}"
    echo "  Directory: $INSTALL_DIR"
    echo "  Data Directory: $DATA_DIR"
    echo "  Log Directory: $LOG_DIR"
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
    echo -e "${CYAN}Uninstall:${NC}"
    echo "  Run: sudo bash $INSTALL_DIR/uninstall.sh"
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

# ============================================
# MAIN INSTALLATION PROCESS
# ============================================

main() {
    print_header
    
    # Check if already installed
    if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
        print_warning "NullName DB appears to be already installed at $INSTALL_DIR"
        if ! confirm "Reinstall/overwrite?"; then
            echo "Installation cancelled."
            exit 0
        fi
    fi
    
    # Run installation steps
    check_requirements
    check_curl
    
    if ! check_nodejs; then
        install_nodejs
    fi
    
    if ! check_npm; then
        install_npm
    fi
    
    if ! check_git; then
        install_git
    fi
    
    collect_input
    create_directories
    generate_env
    generate_package_json
    copy_source_files
    install_dependencies
    create_systemd_service
    create_nginx_config
    setup_ssl
    create_uninstall_script
    start_service
    print_summary
}

# Run main function
main "$@"
