# port_free <port>: succeeds when nothing listens on 127.0.0.1 or the LAN address of that port (a failed TCP connect means free).
port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && ! { [[ -n "${PARITY_SERVER_HOST:-}" ]] && (exec 3<>"/dev/tcp/$PARITY_SERVER_HOST/$1") 2>/dev/null; }
}
