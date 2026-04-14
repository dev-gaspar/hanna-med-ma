# Plan — Orquestación de materia prima (Baptist)

**Objetivo**: después de que el doctor marca un paciente como "Seen", el sistema recolecta sin intervención manual los tres materiales del encounter — `chartId` (CareTracker, ya funciona), `faceSheet` (al crear el encounter desde raw data, ya funciona) y `providerNote` (búsqueda agéntica en Baptist, validada manualmente hoy — falta orquestar).

**Scope explícito**:
- Solo Baptist.
- Solo recolección. La sumisión de reclamos queda fuera.
- **Notificaciones al doctor (chat + push) quedan fuera de este plan** — se suman después; aquí solo dejamos los estados listos para que luego un sistema de notificación los consuma.

---

## Arquitectura (modelo elegido)

Redis es la máquina de estados; el backend es pasivo. Nada de cron en el server.

```
markPatientAsSeen
  ├─ crea encounter con faceSheet + noteStatus=PENDING
  └─ LPUSH delayed: billing:note-search con scheduledFor = now + 4h

RPA scheduler thread (cada 30s)
  └─ mueve tasks maduros del sorted set al queue principal

RPA worker (consume queue principal)
  ├─ PATCH encounter: noteStatus=SEARCHING
  ├─ ejecuta flow
  ├─ genera resumen en lenguaje natural ("I found the Hanna folder, opened
  │   the first note, it was from 04/11/2026 not 07/07/2024, so I checked
  │   the next document and found the signed consultation from 07/07/2024")
  └─ PATCH con el estado resultante + resumen + increment attempts
      ├─ si estado NO terminal y attempts < 6 → re-enqueue con +4h delay
      └─ si terminal o attempts == 6 → no re-enqueue (el estado final queda en BD)
```

Ventana total: 6 intentos × 4h = 24h, que coincide con el `deadline` de 24h del encounter.

---

## Diccionario de estados — `noteStatus`

Reinstalamos `NoteStatus` en `Encounter` pero ahora puramente **informativo / observabilidad**, no control de lógica. Son **5 estados**. Si un estado es "terminal" o no se deriva de `noteAttempts >= 6` (o de `deadline < now`), no hace falta duplicar.

| Estado | Cuándo | Siguiente paso |
|---|---|---|
| `PENDING` | Encounter recién creado, esperando primer intento (4h después de seen) | Scheduler dispara el worker |
| `SEARCHING` | RPA consumió la tarea y empezó a buscar | Termina el intento → transiciona |
| `NOT_FOUND` | Búsqueda completa, no se encontró nota del proveedor para esa fecha | Si `attempts < 6` → re-enqueue +4h; si `attempts == 6` → queda así (terminal) |
| `FOUND_UNSIGNED` | Nota del proveedor encontrada en fecha correcta, pero no firmada aún | Si `attempts < 6` → re-enqueue +4h; si `attempts == 6` → queda así (terminal → detonará notificación al doctor en fase posterior) |
| `FOUND_SIGNED` | Nota encontrada + firmada + validada + subida a S3 + `providerNote` poblado | Terminal ✅ |

**Terminal se deriva**, no se guarda: `isFinal = noteStatus == FOUND_SIGNED || (noteAttempts >= 6) || deadline < now()`.

---

## 1. Schema — re-agregar tracking de nota en `Encounter`

### Checklist

- [x] En `schema.prisma`:
  - [x] Re-agregar `enum NoteStatus` con los 5 valores de la tabla.
  - [x] Agregar a `Encounter`:
    - `noteStatus NoteStatus @default(PENDING)`
    - `noteAttempts Int @default(0)`
    - `noteLastAttemptAt DateTime?`
    - `noteAgentSummary String? @db.Text` — el resumen en lenguaje natural del último intento.
- [x] Crear migración `add_note_tracking_v2` (escribirla a mano para preservar el valor actual de `providerNote`).
- [x] `npx prisma migrate deploy` + verificar con `prisma migrate diff`.

---

## 2. Scheduler de Redis en el RPA (delayed queue pattern)

Redis no tiene tareas diferidas out-of-the-box, pero un sorted set + un scheduler thread lo resuelve en ~40 líneas.

### Diseño

- Cola principal: `billing:note-search` (FIFO, consumida por `BillingNoteWorker` como hoy).
- Cola diferida: `billing:note-search:scheduled` (ZSET; score = timestamp Unix cuando debe ejecutarse).
- Scheduler thread en el RPA: cada 30s hace `ZRANGEBYSCORE ... 0 now()` → para cada item madurado, `ZREM` + `LPUSH` a la cola principal.
- Helper `enqueue_with_delay(queue_name, payload, delay_seconds)` que hace `ZADD`.

### Checklist

- [x] Crear `core/redis_scheduler.py` con:
  - [x] Función `enqueue_with_delay(queue, payload, delay_seconds)` → ZADD al sorted set `<queue>:scheduled`.
  - [x] Clase/función `RedisScheduler` con loop que cada 30s mueve items vencidos del ZSET al LIST (Lua atómico ZREM + LPUSH).
- [x] En `rpa_node.py`:
  - [x] Levantar el scheduler en un thread daemon al arrancar (junto a los Redis consumers).
  - [x] Log al mover cada item: `[SCHEDULER] moved X matured task(s) from <zkey> → <queue>`.
- [ ] Test manual: `ZADD billing:note-search:scheduled <now+10s> <payload>`, verificar que aparece en la cola principal en los próximos ~30s. (Requiere ejecutar el exe — lo valida el usuario tras el build.)

---

## 3. `markPatientAsSeen` — encolar primer intento

### Checklist

- [x] En `rpa.service.ts`, al final de `markPatientAsSeen`:
  - [x] Calcular `scheduledFor = now() + 4 hours`.
  - [x] Construir payload (igual que `push_note_task.ts`, con `attempt=1, maxAttempts=6`).
  - [x] Usar el mismo patrón helper en TS: `RedisService.scheduleTask(queue, data, delaySec)` que hace `ZADD <queue>:scheduled <ts> <payload>`.
  - [x] Llamar solo si `emrSystem=BAPTIST`.
  - [x] Log: `Encounter <id> scheduled for note search in 4h (attempt 1/6)`.
- [x] El encounter queda con `noteStatus=PENDING, noteAttempts=0` (default del schema).
- [ ] Test: marcar un paciente como seen, verificar que el ZSET tiene el item con score ≈ now+4h. (Requiere run real — validar tras el build.)

---

## 4. Worker — PATCH de estado + resumen + re-enqueue con delay

### Lógica por resultado del flow

El `baptist_note_flow.py` ya retorna un dict. Hay que enriquecerlo para incluir:
- `outcome`: uno de `found_signed`, `found_unsigned`, `not_found`.
- `agent_summary`: string en lenguaje natural generado al final del flow (ver paso 5).
- `provider_note_s3_key`: solo si `found_signed`.

### Checklist

- [x] En `billing/worker.py`, al procesar una tarea:
  - [x] Antes de correr el flow: PATCH encounter `noteStatus=SEARCHING, noteLastAttemptAt=now, noteAttempts=attempt`.
  - [x] Ejecutar el flow.
  - [x] Según `result.outcome`:
    - **found_signed** → PATCH `noteStatus=FOUND_SIGNED, providerNote=<s3_key>, noteAgentSummary=<summary>, noteAttempts=attempt`. No re-enqueue. Log.
    - **found_unsigned** → PATCH `noteStatus=FOUND_UNSIGNED, noteAgentSummary=<summary>, noteAttempts=attempt`. Si `attempt < 6` → re-enqueue con delay 4h. Si `attempt == 6` → no re-enqueue.
    - **not_found** → PATCH `noteStatus=NOT_FOUND, noteAgentSummary=<summary>, noteAttempts=attempt`. Si `attempt < 6` → re-enqueue con delay 4h. Si `attempt == 6` → no re-enqueue.
  - [x] Manejo de excepciones del flow: PATCH `noteStatus=NOT_FOUND, noteAgentSummary="Outcome: not_found. Unhandled exception: <msg>"`, re-enqueue si attempts < 6.
- [x] Actualizar endpoint `PATCH /rpa/encounters/:id/note` para aceptar el shape nuevo (todos los campos opcionales; cada PATCH trae solo los que cambian).

---

## 5. Resumen del agente en lenguaje natural

El agente ya genera `reasoning` en cada paso. Lo que falta es un **resumen final que refleje TODO el razonamiento de la IA a lo largo del intento**, sin truncar, para que quede como audit log legible en la BD.

El resumen se persiste en `encounter.noteAgentSummary` (campo `@db.Text`, sin límite práctico). Cada nuevo intento reemplaza el anterior (si importa el historial completo, lo podemos mover a una tabla `EncounterNoteEvent` en la siguiente fase — por ahora guardamos el del último intento, que es el más relevante para decidir la siguiente acción humana).

### Opción de implementación

Al final de cada intento en `baptist_note_flow.py` (antes de retornar), un nuevo sub-agente `NoteExecutionSummarizer` recibe:
- El `encounter` target (doctor, fecha, tipo)
- El `outcome` (found_signed / found_unsigned / not_found)
- **El historial COMPLETO de pasos del NoteFinderAgent** (razonamiento de cada paso, sin corte)
- La razón del validator (si aplica)
- Las razones de cada ronda de `continue_search` si las hubo

Y devuelve un texto narrativo, multi-párrafo si hace falta — **no hay que truncarlo**. Ejemplos esperados:

```
"Started from the Baptist notes tree alphabetized by Performed By. The tree
opened on the 'A' section (Abrams, Aguiar). Pressed 'H' to jump to the H
section, which landed on Hagerman. Scrolled down once and located the
folder 'Hanna, Peter H DF'. Double-clicked to expand it; the first document
inside auto-opened in the right pane: an admission H&P from 04/11/2026 by
Dr. Hernandez. The date didn't match the target 07/07/2024, so pressed
nav_down to move to the next document. The second document was the signed
Podiatry Consultation from 07/07/2024 — matched both doctor and date. The
validator confirmed Hanna, Peter H DPM as the signer on 07/07/2024. PDF
uploaded to S3 key baptist/notes/cuevas_serrano_..._143336.pdf."
```

O para un caso fallido:

```
"Found the 'Hanna, Peter H DF' folder after pressing 'H'. Expanded it and
checked documents via nav_down. The folder contained 4 Podiatry-related
documents; reviewed all of them. None matched the target date 07/07/2024 —
the dates in the folder range from 02/2025 to 04/2026. Either the note
was filed elsewhere or the target date is incorrect for this patient.
Outcome: not_found."
```

### Checklist

- [x] Crear `agentic/emr/baptist/note_summarizer.py` con `NoteExecutionSummarizer` (solo texto, sin imagen, temperatura baja).
- [x] Prompt: recibe encounter target + outcome + **historial completo SIN truncar** + razones del validator → output en prosa narrativa, sin límite de longitud.
- [x] `HEAD_CHARS`/`TAIL_CHARS` no aplica aquí — el input del historial puede ser largo, dejamos que el modelo lo digiera todo (Gemini Flash tiene 1M+ tokens de contexto, suficiente).
- [x] Integrar en `baptist_note_flow.py`: invocar al final del intento (tanto éxito como falla) y poner el resultado en `result["agent_summary"]`.
- [x] El worker pasa ese string al PATCH: `noteAgentSummary` se guarda en BD tal cual (campo `@db.Text`).
- [x] Registrar `agentic.emr.baptist.note_summarizer` en el PyInstaller spec.

---

## 6. Refuerzo al prompt del NoteFinder: "primera nota es la más reciente"

Hoy el agente ya usa `nav_down` para moverse entre documentos y el validator puede rechazar por fecha mala. Falta hacer explícito en el prompt que dentro de la carpeta del proveedor **el primer documento es el más reciente**, y que tiene que bajar (`nav_down`) hasta encontrar la fecha objetivo o agotar la carpeta.

### Checklist

- [x] En `note_finder.py`, agregar al system prompt (Phase B):
  > "Inside the doctor's folder, documents are ordered by date DESCENDING — the first document auto-opened is the MOST RECENT. If you are searching for an encounter from months or years ago, you will likely need to `nav_down` through several newer documents first. Only return `finished` when a plausibly matching document type is auto-opened in the right pane. If you `nav_down` past the end of the folder (the selection leaves the folder or enters another provider's folder), return `error` with reason 'no matching document in folder'."
- [x] Log del agente si detecta que nav_down lo sacó de la carpeta (se convierte en `outcome=not_found` con razón clara).

---

## 7. Test en vivo del tipo `PROGRESS`

### Checklist

- [ ] Identificar un paciente real de Peter con un follow-up/PROGRESS note ya firmado en Baptist.
- [ ] Crear un encounter de tipo `PROGRESS` con la fecha real via script.
- [ ] Dejar que el scheduler lo dispare naturalmente (o `ZADD billing:note-search:scheduled <now+10s> <payload>` manual para acelerar el test).
- [ ] Verificar que el agente identifica "Podiatry Progress Note" (no Consultation) y el validator lo acepta.
- [ ] Si falla, iterar prompt del NoteFinder / NoteValidator.

> **Pendiente de ejecución**: requiere exe nuevo corriendo + un encounter PROGRESS real. Lo hace el usuario una vez que se apruebe el resto del plan y se despliegue.

---

## 8. Endpoint de observabilidad — `GET /rpa/encounters/billing-status`

Ahora es trivial porque todo el estado vive en el modelo `Encounter`.

### Response shape

```json
{
  "encounters": [
    {
      "encounterId": 28,
      "patientName": "Cuevas Serrano, Carlos Edwin",
      "doctorName": "Peter Hanna",
      "type": "CONSULT",
      "dateOfService": "2024-07-07",
      "createdAt": "...",
      "deadline": "...",
      "materials": {
        "chartId": { "ok": true, "value": "553487" },
        "faceSheet": { "ok": true, "value": "baptist/insurance/..." },
        "providerNote": { "ok": true, "value": "baptist/notes/..." }
      },
      "noteTracking": {
        "status": "FOUND_SIGNED",
        "attempts": 1,
        "lastAttemptAt": "2026-04-13T14:33:36Z",
        "summary": "Found Peter Hanna's folder on the second scroll..."
      },
      "overallReady": true
    }
  ]
}
```

`overallReady` = true si los 3 materiales están con `ok=true`.

### Checklist

- [x] Método `getEncountersBillingStatus({doctorId, status, attempts, limit})` en `rpa.service.ts`.
- [x] Endpoint `GET /rpa/encounters/billing-status` en `rpa.controller.ts` (con `JwtAuthGuard`).
- [x] Query params opcionales: `?doctorId=X&status=FOUND_UNSIGNED&attempts=6&limit=50`.
- [ ] Test con curl (se puede hacer en cualquier momento contra el server deployed).

---

## Orden de ejecución sugerido

1. **Schema + migración** (paso 1) — todo lo demás depende de los campos nuevos.
2. **Refuerzo del prompt + test PROGRESS** (pasos 6 y 7) — blindan el flow de búsqueda antes de ponerle orquestación encima.
3. **Resumen del agente** (paso 5) — independiente, útil para los PATCH del worker.
4. **Scheduler de Redis en RPA** (paso 2) — infra de encolado diferido.
5. **markPatientAsSeen encola** (paso 3) — punto de entrada.
6. **Worker con estados + resumen** (paso 4) — la pieza central.
7. **Endpoint de billing-status** (paso 8) — la vista sobre todo lo anterior.

---

## Estimado total

| Paso | Días |
|---|---|
| 1 · Schema + migración | 0.5 |
| 6 · Refuerzo prompt | 0.25 |
| 7 · Test PROGRESS en vivo | 0.5 |
| 5 · NoteExecutionSummarizer | 0.5 |
| 2 · Redis scheduler (RPA) | 0.5 |
| 3 · markPatientAsSeen encola | 0.25 |
| 4 · Worker con estados | 1 |
| 8 · Endpoint billing-status | 0.5 |
| **Total** | **~4 días** |

---

## Definition of Done

- [ ] Un encounter de Baptist recién creado queda con `noteStatus=PENDING` y una tarea en el ZSET `billing:note-search:scheduled`.
- [ ] 4h después, el scheduler la mueve al queue activo, el worker la consume, corre el flow, PATCHea el estado con resumen.
- [ ] Si no se encuentra la nota o está sin firmar, el worker re-encola con +4h (hasta 6 intentos).
- [ ] Al final del ciclo, el encounter tiene un `noteStatus` terminal (`FOUND_SIGNED`, o `NOT_FOUND`/`FOUND_UNSIGNED` con `noteAttempts=6`) con un `noteAgentSummary` legible.
- [ ] `GET /rpa/encounters/billing-status` muestra el cuadro completo.
- [ ] Ambos tipos (`CONSULT` y `PROGRESS`) han sido probados en vivo al menos una vez con éxito.

---

## Contexto para fases siguientes (fuera de este plan)

Cuando un encounter termine con `noteStatus=FOUND_UNSIGNED` y `noteAttempts=6` (o durante la ventana, en cualquier intento con `FOUND_UNSIGNED`), significa que la nota existió pero el doctor no la firmó. Un sistema de notificaciones posterior va a leer estos estados y mandar mensaje por chat + push al doctor pidiéndole que firme. **No es parte de este plan**, pero el `noteAgentSummary` que quedó guardado va a servir como contexto del mensaje.
