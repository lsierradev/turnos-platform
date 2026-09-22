#!/usr/bin/env bash
# setup-sprints.sh
# Crea los 10 Milestones (Sprints) y sus Issues en GitHub para turnos-platform.
#
# Requisitos:
#   - gh CLI instalado y autenticado: gh auth login
#   - Ejecutar este script DESDE la raíz del repo (o exportar GH_REPO=owner/repo)
#
# Uso:
#   chmod +x setup-sprints.sh
#   ./setup-sprints.sh

set -euo pipefail

# Duración de cada sprint en días (2 semanas)
SPRINT_DAYS=14
START_DATE=$(date +%Y-%m-%d)   # cámbialo si tu Sprint 1 no arranca hoy, ej: START_DATE="2026-10-01"

echo "Repositorio detectado: $(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Fecha de inicio Sprint 1: $START_DATE"
echo

create_milestone() {
  local number="$1" title="$2" description="$3"
  local due
  due=$(date -d "$START_DATE + $((number * SPRINT_DAYS)) days" +%Y-%m-%d 2>/dev/null \
        || date -j -v+"$((number * SPRINT_DAYS))"d -f "%Y-%m-%d" "$START_DATE" +%Y-%m-%d)
  echo "→ Creando milestone: $title (due $due)"
  gh api repos/:owner/:repo/milestones \
    -f title="$title" \
    -f description="$description" \
    -f due_on="${due}T23:59:59Z" \
    --silent || echo "   (ya existe, se omite)"
}

create_issue() {
  local milestone="$1" title="$2" body="$3" labels="$4"
  echo "   • Issue: $title"
  gh issue create \
    --title "$title" \
    --body "$body" \
    --milestone "$milestone" \
    --label "$labels" \
    >/dev/null 2>&1 \
    || gh issue create --title "$title" --body "$body" --milestone "$milestone" >/dev/null
}

create_label() {
  local name="$1" color="$2" description="$3"
  gh label create "$name" --color "$color" --description "$description" --force >/dev/null 2>&1 \
    && echo "   ✓ label: $name" \
    || echo "   ⚠ label: $name (no se pudo crear/actualizar)"
}

# ---------- Labels ----------
# Se crean (o actualizan) antes de los issues para que ninguno quede sin
# etiquetar: gh issue create falla en silencio si la label no existe todavia.
echo "Creando labels..."
create_label "infra"       "5319e7" "Infraestructura, despliegue, CI/CD"
create_label "backend"     "1d76db" "NestJS / API"
create_label "db"          "006b75" "Esquema y consultas de base de datos"
create_label "ux"          "d876e3" "Diseno de experiencia de usuario"
create_label "security"    "b60205" "Autenticacion, autorizacion, seguridad"
create_label "testing"     "fbca04" "Tests unitarios, integracion o e2e"
create_label "frontend"    "0052cc" "React / UI"
create_label "feature"     "0e8a16" "Historia de usuario / funcionalidad"
create_label "chore"       "c5def5" "Mantenimiento y tareas internas"
create_label "integration" "bfdadc" "Integraciones con terceros (Twilio, Stripe, etc.)"
create_label "docs"        "0075ca" "Documentacion"
create_label "perf"        "e99695" "Rendimiento"
create_label "qa"          "fef2c0" "Calidad / criterios de aceptacion"
create_label "launch"      "f9d0c4" "Go-live y lanzamiento"
echo

# ---------- Sprint 1 ----------
create_milestone 1 "Sprint 1 - Discovery" "Semanas 1-2. Arquitectura y base del proyecto definidas."
create_issue "Sprint 1 - Discovery" "Definir arquitectura de microservicios NestJS (reservas/usuarios)" "Proponer organización de carpetas para módulos de reservas y usuarios." "infra"
create_issue "Sprint 1 - Discovery" "Crear esquema PostgreSQL tabla turnos con EXCLUDE USING gist" "id, bahia_id, rango_tiempo (TSRANGE), restricción EXCLUDE GIST (requiere btree_gist)." "backend,db"
create_issue "Sprint 1 - Discovery" "Configurar pipeline CI/CD (lint + tests en cada push)" "GitHub Actions básico." "infra"
create_issue "Sprint 1 - Discovery" "Wireframes portal cliente y panel admin" "Diseños base de UI/UX para validar con stakeholders." "ux"
create_issue "Sprint 1 - Discovery" "Provisión inicial AWS (RDS, EKS)" "Ambientes base de infraestructura." "infra"

# ---------- Sprint 2 ----------
create_milestone 2 "Sprint 2 - Auth y modelo de datos" "Semanas 3-4. Base de datos y seguridad de acceso (RNF-01)."
create_issue "Sprint 2 - Auth y modelo de datos" "Implementar AuthModule con JWT" "Login, refresh token, guard reutilizable." "backend,security"
create_issue "Sprint 2 - Auth y modelo de datos" "Encriptación de datos sensibles (RNF-01)" "Cifrado en reposo/tránsito de datos sensibles." "backend,security"
create_issue "Sprint 2 - Auth y modelo de datos" "Entidades Usuario/Bahia/Servicio/Turno" "Modelo de datos completo." "backend,db"
create_issue "Sprint 2 - Auth y modelo de datos" "CRUD de Servicio protegido por guard" "Categorías: Mecánica, Eléctrica, Latonería." "backend"
create_issue "Sprint 2 - Auth y modelo de datos" "Tests unitarios AuthService y CRUD Servicio" "Cobertura mínima del módulo de auth y servicios." "testing"

# ---------- Sprint 3 ----------
create_milestone 3 "Sprint 3 - Motor de reservas (RF-01, RF-02)" "Semanas 5-6. Objetivo específico 1."
create_issue "Sprint 3 - Motor de reservas (RF-01, RF-02)" "Endpoint POST /appointments" "Flujo de selección marca/modelo/servicio (RF-01)." "backend"
create_issue "Sprint 3 - Motor de reservas (RF-01, RF-02)" "Manejo de conflicto Postgres 23P01" "Capturar error EXCLUDE GIST y lanzar ConflictException (RF-02)." "backend"
create_issue "Sprint 3 - Motor de reservas (RF-01, RF-02)" "Sugerencia de horarios alternos ante conflicto" "Mostrar 3 horarios disponibles más cercanos." "backend"
create_issue "Sprint 3 - Motor de reservas (RF-01, RF-02)" "Tests de integración de reserva concurrente" "Verificar que solo una reserva se confirme sobre la misma bahía." "testing"
create_issue "Sprint 3 - Motor de reservas (RF-01, RF-02)" "HU1 y HU2 completas" "Cierre de las dos historias de usuario del sprint." "feature"

# ---------- Sprint 4 ----------
create_milestone 4 "Sprint 4 - Agenda técnica y panel admin" "Semanas 7-8. Objetivo específico 2."
create_issue "Sprint 4 - Agenda técnica y panel admin" "Endpoint GET /technicians/:id/agenda" "Citas del día para un técnico." "backend"
create_issue "Sprint 4 - Agenda técnica y panel admin" "Validar disponibilidad por mecánico" "Extender RF-01 para no solo validar bahía." "backend"
create_issue "Sprint 4 - Agenda técnica y panel admin" "Vista React Agenda del técnico" "Componente de agenda diaria." "frontend"
create_issue "Sprint 4 - Agenda técnica y panel admin" "Vista React Panel administrativo v1" "Carga de trabajo diaria por bahía." "frontend"
create_issue "Sprint 4 - Agenda técnica y panel admin" "Integrar TanStack Query" "Estado async fluido, sin parpadeos al refrescar." "frontend"

# ---------- Sprint 5 ----------
create_milestone 5 "Sprint 5 - Estabilización MVP Core" "Semanas 9-10. Cierre de Fase 1."
create_issue "Sprint 5 - Estabilización MVP Core" "Test de carga 50 reservas concurrentes" "k6 o autocannon sobre la misma bahía." "testing"
create_issue "Sprint 5 - Estabilización MVP Core" "Mejoras UX flujo de reserva" "Loading states, optimistic UI, manejo de errores de conflicto." "frontend"
create_issue "Sprint 5 - Estabilización MVP Core" "Code review módulo de reservas" "Registrar deuda técnica priorizada por riesgo." "chore"

# ---------- Sprint 6 ----------
create_milestone 6 "Sprint 6 - Notificaciones (RF-03)" "Semanas 11-12. Objetivo específico 3."
create_issue "Sprint 6 - Notificaciones (RF-03)" "NotificationModule con cron de recordatorio 24h" "Job programado sobre turnos próximos." "backend"
create_issue "Sprint 6 - Notificaciones (RF-03)" "Integración Twilio (WhatsApp)" "Envío de notificaciones vía WhatsApp." "integration"
create_issue "Sprint 6 - Notificaciones (RF-03)" "Integración SendGrid (Email)" "Envío de notificaciones vía Email." "integration"
create_issue "Sprint 6 - Notificaciones (RF-03)" "Cola de reintentos con Bull/Redis" "Reintentos ante fallos de envío." "backend"
create_issue "Sprint 6 - Notificaciones (RF-03)" "Test de caída de proveedor y reintento" "Simular fallo de Twilio/SendGrid." "testing"

# ---------- Sprint 7 ----------
create_milestone 7 "Sprint 7 - Pagos" "Semanas 13-14."
create_issue "Sprint 7 - Pagos" "Endpoint POST /appointments/:id/payment-intent" "Creación de PaymentIntent en Stripe." "backend,integration"
create_issue "Sprint 7 - Pagos" "Webhook de confirmación de pago" "Actualizar estado del turno tras el pago." "backend"
create_issue "Sprint 7 - Pagos" "Manejo de pago fallido" "No romper la reserva ya bloqueada en BD." "backend"
create_issue "Sprint 7 - Pagos" "Documentar llaves sandbox en README" "Instrucciones de configuración de Stripe test." "docs"

# ---------- Sprint 8 ----------
create_milestone 8 "Sprint 8 - Dashboard de KPIs (RF-04)" "Semanas 15-16. Objetivos específicos 2 y 4."
create_issue "Sprint 8 - Dashboard de KPIs (RF-04)" "Endpoint GET /dashboard/kpis" "Tasa de asistencia y tiempo promedio de servicio." "backend"
create_issue "Sprint 8 - Dashboard de KPIs (RF-04)" "Vista React con gráficos (recharts)" "Filtro de rango de fechas." "frontend"
create_issue "Sprint 8 - Dashboard de KPIs (RF-04)" "Optimizar query con EXPLAIN ANALYZE" "Verificar plan de consulta antes de dar por óptima." "db,perf"

# ---------- Sprint 9 ----------
create_milestone 9 "Sprint 9 - QA y Beta cerrado" "Semanas 17-18."
create_issue "Sprint 9 - QA y Beta cerrado" "Suite E2E (Playwright) de las 4 HU" "Cobertura completa de las historias de usuario del SRS." "testing"
create_issue "Sprint 9 - QA y Beta cerrado" "Revisión de validación de entrada en endpoints" "Auditoría de inputs sin validar o sin manejo de errores." "security"
create_issue "Sprint 9 - QA y Beta cerrado" "Checklist de Criterios de Aceptación Generales" "Basado en la sección 14 del SRS." "qa"
create_issue "Sprint 9 - QA y Beta cerrado" "Ejecutar Beta cerrado con un CDA real" "Recolectar feedback de los 4 perfiles de stakeholders." "launch"

# ---------- Sprint 10 ----------
create_milestone 10 "Sprint 10 - Go-Live" "Semanas 19-20. Objetivo general cumplido."
create_issue "Sprint 10 - Go-Live" "Validar despliegue Docker/K8s en AWS EKS" "Confirmar arquitectura de producción (RNF-02)." "infra"
create_issue "Sprint 10 - Go-Live" "Health checks para SLA 99.9%" "Script de verificación de salud (RNF-03)." "infra"
create_issue "Sprint 10 - Go-Live" "Optimizar endpoints que no cumplan p95 < 300ms" "Detectados en Sprint 9." "perf"
create_issue "Sprint 10 - Go-Live" "README de despliegue y manual para administradores" "Documentación final del proyecto." "docs"
create_issue "Sprint 10 - Go-Live" "Checklist final de Go-Live" "Basado en los Criterios de Aceptación Generales del SRS." "launch"

echo
echo "Listo. Revisa https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/milestones"
