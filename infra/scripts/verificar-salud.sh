#!/usr/bin/env bash
# Verificacion de salud post-deploy (RNF-03, issue #41).
#
# Comprueba que los tres componentes responden y que los servicios ALCANZAN
# sus dependencias. Pensado para correrlo:
#   - como smoke test despues de cada deploy (sale != 0 si algo falla)
#   - a mano durante un incidente, para ubicar que pieza se cayo
#
# Uso:
#   BASE_API=https://api.ejemplo.com \
#   BASE_AUTH=https://auth.ejemplo.com \
#   BASE_WEB=https://turnos.ejemplo.com \
#   ./infra/scripts/verificar-salud.sh
#
# Por defecto apunta a los puertos locales de `docker compose --profile full up`.

set -uo pipefail

BASE_API="${BASE_API:-http://localhost:3001}"
BASE_AUTH="${BASE_AUTH:-http://localhost:3002}"
BASE_WEB="${BASE_WEB:-http://localhost:8080}"
TIMEOUT="${TIMEOUT:-10}"

fallos=0

verificar() {
  local nombre="$1" url="$2" esperado="${3:-200}"
  local codigo cuerpo

  cuerpo="$(curl -sS --max-time "$TIMEOUT" -w $'\n%{http_code}' "$url" 2>&1)" || {
    printf '  [FALLA] %-34s %s (sin respuesta)\n' "$nombre" "$url"
    fallos=$((fallos + 1))
    return
  }

  codigo="$(printf '%s' "$cuerpo" | tail -n1)"
  cuerpo="$(printf '%s' "$cuerpo" | sed '$d')"

  if [ "$codigo" = "$esperado" ]; then
    printf '  [OK]    %-34s %s\n' "$nombre" "$codigo"
  else
    printf '  [FALLA] %-34s esperado %s, recibido %s\n' "$nombre" "$esperado" "$codigo"
    # El cuerpo del readiness dice CUAL dependencia se cayo. Durante un
    # incidente esa linea es la informacion mas util del script.
    [ -n "$cuerpo" ] && printf '          %s\n' "$cuerpo"
    fallos=$((fallos + 1))
  fi
}

echo "Verificando turnos-platform"
echo "  api:  $BASE_API"
echo "  auth: $BASE_AUTH"
echo "  web:  $BASE_WEB"
echo

echo "Liveness (el proceso responde):"
verificar "reservas-service"        "$BASE_API/reservas/health"
verificar "usuarios-service"        "$BASE_AUTH/usuarios/health"
verificar "admin-web"               "$BASE_WEB/health"

echo
echo "Readiness (ademas alcanza sus dependencias):"
verificar "reservas-service + pg/redis" "$BASE_API/reservas/health/ready"
verificar "usuarios-service + pg"       "$BASE_AUTH/usuarios/health/ready"

echo
echo "Contrato de seguridad (deben RECHAZAR, no responder):"
# Si alguna de estas devuelve 200, el deploy quedo sin guard: cualquiera en
# internet podria leer los KPIs o la agenda del taller. Vale tanto como los
# chequeos de salud.
verificar "GET /dashboard/kpis sin token"  "$BASE_API/dashboard/kpis" 401
verificar "GET /servicios sin token"       "$BASE_API/servicios"      401

echo
if [ "$fallos" -eq 0 ]; then
  echo "Todo OK."
  exit 0
fi

echo "$fallos verificacion(es) fallaron."
exit 1
