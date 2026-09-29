# Hanork — banner + dashboard (fish). Sourced from # HANORK START block.

if not status is-interactive
    return
end

if set -q HANORK_WELCOME_SHOWN; and test "$HANORK_FORCE_WELCOME" != "1"
    return
end

set -gx HANORK_WELCOME_SHOWN 1

function _hanork_banner
    set -l ver (cd "$HANORK_ROOT" 2>/dev/null; and node -p "require('./package.json').version" 2>/dev/null; or echo '?.?.?')
    if command -q figlet
        figlet -f standard HANORK 2>/dev/null
    else
        echo '██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗'
        echo '██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝'
        echo '███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝'
        echo '██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗'
        echo '██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗'
        echo '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝'
    end
    echo ""
    echo "Hanork Platform"
    echo "Telegram Commerce Engine"
    echo "Version: $ver"
    echo ""
end

function _hanork_status_line
    set -l name $argv[1]
    set -l cmd $argv[2]
    if eval $cmd >/dev/null 2>&1
        echo "$name: ONLINE"
    else
        echo "$name: OFFLINE"
    end
end

function _hanork_dashboard
    set -l host (hostname 2>/dev/null; or echo '?')
    set -l user (whoami 2>/dev/null; or echo '?')
    set -l local_ip (hostname -I 2>/dev/null | awk '{print $1}'; or echo '?')
    set -l pub_ip (curl -fsS --max-time 2 https://api.ipify.org 2>/dev/null; or echo 'n/a')
    set -l os_ver (bash -c 'source /etc/os-release 2>/dev/null; echo ${PRETTY_NAME:-Linux}' 2>/dev/null; or echo 'Linux')

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "HOST: $host  |  USER: $user"
    echo "IP Local: $local_ip  |  IP Público: $pub_ip"
    echo "OS: $os_ver"
    echo ""
    echo "HANORK STATUS"
    echo ""
    _hanork_status_line Redis 'redis-cli ping 2>/dev/null | grep -q PONG'
    _hanork_status_line PostgreSQL 'pg_isready -q 2>/dev/null'
    _hanork_status_line PM2 'command -v pm2 >/dev/null && pm2 ping 2>/dev/null'
    _hanork_status_line Hanork 'bash "$HANORK_ROOT/scripts/hanork-ctl.sh" status 2>/dev/null | grep -q "Bot rodando"'
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
end

function _hanork_aliases
    if test -d "$HANORK_ROOT"
        function hanork; cd "$HANORK_ROOT"; and bash scripts/hanork-boot.sh; end
        function hanork-stop; cd "$HANORK_ROOT"; and bash scripts/hanork-ctl.sh stop; end
        function hanork-status; cd "$HANORK_ROOT"; and bash scripts/hanork-ctl.sh status; end
        function hanork-terminal-restore; cd "$HANORK_ROOT"; and npm run terminal:restore; end
    end
end

if test -n "$HANORK_ROOT"; and test -d "$HANORK_ROOT"
    command -q clear; and clear
    _hanork_aliases
    _hanork_banner
    if command -q fastfetch
        fastfetch 2>/dev/null
        echo ""
    else if command -q neofetch
        neofetch 2>/dev/null
        echo ""
    end
    if test -z "$HANORK_BOT_STARTED"
        set -gx HANORK_BOT_STARTED 1
        set -gx HANORK_AUTOSTART "${HANORK_AUTOSTART:-1}"
        if test "$HANORK_AUTOSTART" = "1"
            bash "$HANORK_ROOT/scripts/hanork-boot.sh" || true
        end
    end
    _hanork_dashboard
end
