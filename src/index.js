// ============================================================================
// CazaPhish - Motor de Detección de Phishing con IA en Cloudflare Workers
// Roles: RF1 (/api/analyze), RF2 (Autenticación API Key), RF3 (Dashboard y Revocación)
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}

// Inicializa el esquema de producción en D1 y el Administrador Genérico
async function asegurarEsquemaBase(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS administradores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        usuario TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        rol TEXT DEFAULT 'ADMINISTRADOR',
        activo INTEGER DEFAULT 1,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS terceros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        activo INTEGER DEFAULT 1,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS reportes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tercero_id INTEGER NOT NULL,
        texto_original TEXT NOT NULL,
        veredicto_ia TEXT NOT NULL,
        estado TEXT DEFAULT 'ACTIVO',
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL,
        rol TEXT NOT NULL,
        accion TEXT NOT NULL,
        estado TEXT NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Usuario genérico administrador de producción
    await env.DB.prepare(
      `INSERT OR IGNORE INTO administradores (id, nombre, usuario, password, rol, activo)
       VALUES (1, 'Administrador General', 'admin@cazaphish.com', 'Admin2026*', 'ADMINISTRADOR', 1)`
    ).run();

    // Llave principal del sistema detector web en producción
    await env.DB.prepare(
      `INSERT OR IGNORE INTO terceros (id, nombre, api_key, activo)
       VALUES (1, 'Portal Web CazaPhish (Interno)', 'alpha-secret-key-2026', 1)`
    ).run();
  } catch (e) {}
}

async function registrarLogAcceso(env, usuario, rol, accion, estado = 'OK') {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'INSERT INTO access_logs (usuario, rol, accion, estado) VALUES (?, ?, ?, ?)'
    ).bind(usuario, rol, accion, estado).run();
  } catch (e) {}
}

// ----------------------------------------------------------------------------
// RF2: Autenticación por API Key (vía Body, Header x-api-key, Bearer o QueryParam para Webhooks)
// ----------------------------------------------------------------------------
async function autenticarTercero(request, env, body = {}) {
  const url = new URL(request.url);
  const apiKey =
    body.api_key ||
    request.headers.get('x-api-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('api_key');

  if (!apiKey) {
    return { error: 'Falta la API Key obligatoria (envía api_key en el body, query ?api_key= o header x-api-key)', status: 401 };
  }

  try {
    await asegurarEsquemaBase(env);
    const stmt = env.DB.prepare('SELECT id, nombre, activo FROM terceros WHERE api_key = ?');
    const tercero = await stmt.bind(apiKey).first();

    if (!tercero) {
      await registrarLogAcceso(env, apiKey, 'API_TERCERO', 'Intento de acceso con API Key inválida', 'DENEGADO');
      return { error: 'API Key no registrada o no válida', status: 401 };
    }

    if (!tercero.activo) {
      await registrarLogAcceso(env, tercero.nombre, 'API_TERCERO', 'Intento de acceso con API Key revocada', 'REVOCADO');
      return { error: 'La cuenta corporativa asociada a esta API Key se encuentra suspendida', status: 403 };
    }

    return { tercero };
  } catch (err) {
    return { error: `Error verificando autenticación en D1: ${err.message}`, status: 500 };
  }
}

// ----------------------------------------------------------------------------
// Extractor Universal de Texto (Soporta Portal Web, WhatsApp, Telegram, n8n y Email Gateways)
// ----------------------------------------------------------------------------
function extraerTextoUniversal(body = {}) {
  if (!body || typeof body !== 'object') return '';

  // 1. Formato nativo de CazaPhish o genérico de bots (texto, text, message, body, Body de Twilio)
  const directo =
    body.texto ||
    body.text ||
    body.mensaje ||
    body.message?.text ||
    (typeof body.message === 'string' ? body.message : '') ||
    body.Body ||
    body.content;

  if (typeof directo === 'string' && directo.trim()) {
    return directo.trim();
  }

  // 2. Formato Meta WhatsApp Cloud API Webhook
  const waCloudText = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
  if (typeof waCloudText === 'string' && waCloudText.trim()) {
    return waCloudText.trim();
  }

  // 3. Formato Evolution API / Baileys (WhatsApp autoalojado)
  const waEvolutionText =
    body.data?.message?.conversation ||
    body.data?.message?.extendedTextMessage?.text;
  if (typeof waEvolutionText === 'string' && waEvolutionText.trim()) {
    return waEvolutionText.trim();
  }

  // 4. Formato Pasarelas de Correo (SendGrid, Mailgun, Postmark, Cloudflare Email)
  if (body.from || body.sender || body.subject || body.html) {
    return `De: ${body.from || body.sender || ''}\nAsunto: ${body.subject || ''}\n\n${body.body || body.html || ''}`.trim();
  }

  return '';
}

// ----------------------------------------------------------------------------
// Disparo de Webhook Saliente en Segundo Plano (para alertas a otros servicios)
// ----------------------------------------------------------------------------
async function dispararWebhookSaliente(urlDestino, payloadAlerta) {
  if (!urlDestino) return;
  try {
    await fetch(urlDestino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadAlerta)
    });
  } catch (err) {
    console.error('Error enviando webhook saliente:', err.message);
  }
}

// ----------------------------------------------------------------------------
// RNF: Privacidad - Anonimización de PII antes de guardar en D1
// ----------------------------------------------------------------------------
function anonimizarTexto(texto) {
  if (!texto) return '';
  return texto
    // Enmascarar direcciones de correo electrónico
    .replace(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_PROTEGIDO]')
    // Enmascarar números de teléfono internacionales o locales
    .replace(/(\+?\d{1,4}[-.\s]?)?(\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g, '[TELEFONO_PROTEGIDO]')
    // Enmascarar secuencias de tarjetas de crédito o cuentas (16 dígitos)
    .replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[TARJETA_PROTEGIDA]');
}

// ----------------------------------------------------------------------------
// Parser robusto para garantizar formato estricto de IA
// ----------------------------------------------------------------------------
function parsearVeredictoIA(rawResponse) {
  let rawText = '';
  if (rawResponse?.choices?.[0]?.message?.content) {
    rawText = rawResponse.choices[0].message.content;
  } else if (rawResponse && typeof rawResponse.response === 'string') {
    rawText = rawResponse.response;
  } else if (typeof rawResponse === 'string') {
    rawText = rawResponse;
  } else {
    rawText = JSON.stringify(rawResponse || {});
  }

  // Quitar etiquetas Markdown tipo ```json ... ``` si la IA las incluye
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const riesgo = String(parsed.riesgo || 'MEDIO').toUpperCase();
    const riesgoValido = ['ALTO', 'MEDIO', 'BAJO'].includes(riesgo) ? riesgo : 'MEDIO';

    return {
      riesgo: riesgoValido,
      razones: Array.isArray(parsed.razones) ? parsed.razones : [parsed.razones || 'Patrón sospechoso detectado.'],
      recomendacion: String(parsed.recomendacion || 'Proceder con precaución y verificar el remitente.')
    };
  } catch (e) {
    // Intento con regex para extraer el bloque {...}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const fallback = JSON.parse(match[0]);
        const riesgo = String(fallback.riesgo || 'MEDIO').toUpperCase();
        return {
          riesgo: ['ALTO', 'MEDIO', 'BAJO'].includes(riesgo) ? riesgo : 'MEDIO',
          razones: Array.isArray(fallback.razones) ? fallback.razones : [fallback.razones || 'Anomalías detectadas.'],
          recomendacion: String(fallback.recomendacion || 'No abrir enlaces sospechosos.')
        };
      } catch (err) {}
    }
  }

  // Fallback seguro si la respuesta no vino en JSON
  return {
    riesgo: 'MEDIO',
    razones: ['La IA detectó contenido anómalo pero la respuesta no pudo estructurarse automáticamente.'],
    recomendacion: 'Verifique directamente con el emisor a través de un canal oficial alternativo.'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight CORS para navegadores
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ------------------------------------------------------------------------
    // HEALTH CHECK / PRUEBA IA
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/test-ia' && request.method === 'GET') {
      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            { role: 'system', content: 'Responde solo con la palabra OK' },
            { role: 'user', content: 'Ping' }
          ]
        });
        return jsonResponse({ exito: true, respuesta: aiResponse });
      } catch (error) {
        return jsonResponse({ exito: false, error: error.message }, 500);
      }
    }

    // ------------------------------------------------------------------------
    // RF1: POST /api/analyze (y alias /api/webhook) - Análisis con IA y Webhooks
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/analyze' || url.pathname === '/api/webhook') {
      // Verificación GET estándar para Webhooks de Meta WhatsApp Cloud API
      if (request.method === 'GET' && url.searchParams.has('hub.challenge')) {
        return new Response(url.searchParams.get('hub.challenge'), { status: 200 });
      }

      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Método no permitido. Utiliza POST.' }, 405);
      }

      let body = {};
      try {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const formData = await request.formData();
          body = Object.fromEntries(formData.entries());
        } else {
          body = await request.json();
        }
      } catch {
        return jsonResponse({ error: 'Cuerpo de la petición inválido. Debe ser JSON o Form-Data.' }, 400);
      }

      const texto = extraerTextoUniversal(body);
      if (!texto) {
        return jsonResponse({ error: 'El campo "texto" es obligatorio para analizar el correo o mensaje.' }, 400);
      }

      // RF2: Autenticación
      const auth = await autenticarTercero(request, env, body);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      // Inferencia con Cloudflare Workers AI
      const systemPrompt = `Eres un auditor experto en ciberseguridad para CazaPhish. Analizas correos y mensajes dirigidos a funcionarios e instituciones públicas para detectar ingeniería social y phishing.
DEBES RESPONDER EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO con esta estructura exacta:
{
  "riesgo": "ALTO" | "MEDIO" | "BAJO",
  "razones": ["motivo 1 explicable", "motivo 2..."],
  "recomendacion": "acción clara y preventiva para el funcionario"
}

Criterios de clasificación estricta (Semáforo de Ciberseguridad):
- ALTO (Peligro Crítico / Ataque Flagrante):
  * Solicitud explícita de contraseñas, claves de acceso, PINs o códigos 2FA.
  * Suplantación evidente de identidad (spoofing descarado, remitente externo haciéndose pasar por entidad bancaria o estatal con dominio falso).
  * Amenazas extorsivas o coercitivas inmediatas ("su cuenta será bloqueada/borrada en 2 horas si no actúa ya").
  * Enlaces a páginas de phishing conocidas, ejecutables (.exe, .bat, .scr) o descargas maliciosas.

- MEDIO (Sospechoso / Alerta Preventiva / Requiere Verificación Humana):
  * El correo aparenta provenir de un canal interno o institucional legítimo (ej. @uneti.edu.ve, departamento de RRHH o soporte interno), pero solicita actualizar datos bancarios o información administrativa a través de plataformas externas de terceros (ej. enlaces a Google Drive, Google Forms, Dropbox).
  * No pide contraseñas directas, pero utiliza pretextos laborales creíbles (ej. bono de fin de año, actualización de nómina, revisión de beneficios) con una fecha límite administrativa moderada (ej. "antes del viernes").
  * No hay certeza absoluta de ataque destructivo, pero viola las políticas de seguridad institucional y el funcionario debe verificar con el emisor por un canal seguro antes de enviar información.

- BAJO (Seguro / Comunicación Rutinaria):
  * Comunicados institucionales, circulares internas o notificaciones de servicio sin enlaces externos sospechosos ni solicitudes de datos bancarios o credenciales.

No agregues bloques markdown ni texto adicional. Responde únicamente el JSON en español.`;

      let veredicto;
      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analiza el siguiente texto:\n\n${texto}` }
          ]
        });
        veredicto = parsearVeredictoIA(aiResponse);
      } catch (err) {
        return jsonResponse({
          exito: false,
          error: `Error al procesar con Workers AI: ${err.message}`
        }, 502);
      }

      // RNF: Anonimizar texto sensible antes de guardar en D1
      const textoAnonimizado = anonimizarTexto(texto);

      // Persistencia en SQLite Serverless (Cloudflare D1)
      let reporteId = null;
      try {
        const insertStmt = env.DB.prepare(
          'INSERT INTO reportes (tercero_id, texto_original, veredicto_ia, estado) VALUES (?, ?, ?, ?)'
        );
        const res = await insertStmt.bind(
          tercero.id,
          textoAnonimizado,
          JSON.stringify(veredicto),
          'ACTIVO'
        ).run();
        reporteId = res.meta?.last_row_id || null;

        await registrarLogAcceso(
          env,
          tercero.nombre,
          'API_TERCERO',
          `Analizó correo (Riesgo ${veredicto.riesgo})`,
          'PERMITIDO'
        );
      } catch (dbErr) {
        console.error('Error al guardar reporte en D1:', dbErr);
      }

      // Mensaje pre-formateado listo para que bots de WhatsApp / Telegram respondan directo al usuario
      const respuestaBot =
        `*CazaPhish - Diagnóstico IA*\n` +
        `*Nivel de Riesgo:* ${veredicto.riesgo}\n\n` +
        `*Motivos detectados:*\n${veredicto.razones.map(r => `• ${r}`).join('\n')}\n\n` +
        `*Recomendación:* ${veredicto.recomendacion}`;

      // Webhook saliente opcional en segundo plano si el tercero envía "webhook_url" o existe env.WEBHOOK_ALERTA_URL
      const webhookDestino = body.webhook_url || env.WEBHOOK_ALERTA_URL;
      if (webhookDestino && (veredicto.riesgo === 'ALTO' || body.notificar_siempre)) {
        ctx.waitUntil(
          dispararWebhookSaliente(webhookDestino, {
            evento: 'ALERTA_CAZAPHISH',
            tercero: tercero.nombre,
            riesgo: veredicto.riesgo,
            razones: veredicto.razones,
            recomendacion: veredicto.recomendacion,
            respuesta_bot: respuestaBot,
            texto_anonimizado: textoAnonimizado,
            fecha: new Date().toISOString()
          })
        );
      }

      // Devolvemos el contrato exacto esperado por el frontend + respuesta_bot para integraciones de WhatsApp
      return jsonResponse({
        exito: true,
        reporte_id: reporteId,
        tercero: tercero.nombre,
        riesgo: veredicto.riesgo,
        razones: veredicto.razones,
        recomendacion: veredicto.recomendacion,
        texto_anonimizado: textoAnonimizado,
        respuesta_bot: respuestaBot
      });
    }

    // ------------------------------------------------------------------------
    // RF3: GET /api/reports/stats - Métricas & KPIs para el Dashboard
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/reports/stats') {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'Método no permitido. Utiliza GET.' }, 405);
      }

      const auth = await autenticarTercero(request, env);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      try {
        const { results } = await env.DB.prepare(
          'SELECT id, veredicto_ia, estado, fecha FROM reportes WHERE tercero_id = ?'
        ).bind(tercero.id).all();

        const rows = results || [];
        let alto = 0, medio = 0, bajo = 0, activos = 0, revocados = 0;

        for (const r of rows) {
          if (r.estado === 'REVOCADO') {
            revocados++;
          } else {
            activos++;
          }

          let riesgo = 'MEDIO';
          try {
            const parsed = JSON.parse(r.veredicto_ia);
            riesgo = String(parsed.riesgo || 'MEDIO').toUpperCase();
          } catch {}

          if (riesgo === 'ALTO') alto++;
          else if (riesgo === 'BAJO') bajo++;
          else medio++;
        }

        const total = rows.length;
        const porcentajeCritico = total > 0 ? Number(((alto / total) * 100).toFixed(1)) : 0;
        const porcentajeMitigado = total > 0 ? Number(((revocados / total) * 100).toFixed(1)) : 0;

        return jsonResponse({
          exito: true,
          tercero: tercero.nombre,
          kpis: {
            total_incidentes: total,
            activos,
            revocados,
            desglose_riesgo: {
              alto,
              medio,
              bajo
            },
            porcentaje_critico: porcentajeCritico,
            porcentaje_mitigado: porcentajeMitigado
          }
        });
      } catch (err) {
        return jsonResponse({ error: `Error calculando estadísticas: ${err.message}` }, 500);
      }
    }

    // ------------------------------------------------------------------------
    // RF3: GET /api/reports - Listado de reportes para el panel de administración
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/reports') {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'Método no permitido. Utiliza GET.' }, 405);
      }

      const auth = await autenticarTercero(request, env);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      try {
        const { results } = await env.DB.prepare(
          'SELECT id, texto_original, veredicto_ia, estado, fecha FROM reportes WHERE tercero_id = ? ORDER BY fecha DESC LIMIT 50'
        ).bind(tercero.id).all();

        const reportes = (results || []).map(r => {
          let parsed;
          try {
            parsed = JSON.parse(r.veredicto_ia);
          } catch {
            parsed = { raw: r.veredicto_ia };
          }
          return {
            id: r.id,
            texto_anonimizado: r.texto_original,
            veredicto: parsed,
            estado: r.estado,
            fecha: r.fecha
          };
        });

        return jsonResponse({
          exito: true,
          tercero: tercero.nombre,
          total: reportes.length,
          reportes
        });
      } catch (err) {
        return jsonResponse({ error: `Error al consultar reportes: ${err.message}` }, 500);
      }
    }

    // ------------------------------------------------------------------------
    // RF3: GET /api/reports/:id - Detalle de un reporte específico
    // ------------------------------------------------------------------------
    const reportDetailMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
    if (reportDetailMatch) {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'Método no permitido. Utiliza GET.' }, 405);
      }

      const reporteId = parseInt(reportDetailMatch[1], 10);
      const auth = await autenticarTercero(request, env);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      try {
        const row = await env.DB.prepare(
          'SELECT id, texto_original, veredicto_ia, estado, fecha FROM reportes WHERE id = ? AND tercero_id = ?'
        ).bind(reporteId, tercero.id).first();

        if (!row) {
          return jsonResponse({ error: `Reporte #${reporteId} no encontrado o no pertenece a tu cuenta.` }, 404);
        }

        let veredicto;
        try {
          veredicto = JSON.parse(row.veredicto_ia);
        } catch {
          veredicto = { raw: row.veredicto_ia };
        }

        return jsonResponse({
          exito: true,
          tercero: tercero.nombre,
          reporte: {
            id: row.id,
            texto_anonimizado: row.texto_original,
            veredicto,
            estado: row.estado,
            fecha: row.fecha
          }
        });
      } catch (err) {
        return jsonResponse({ error: `Error obteniendo reporte #${reporteId}: ${err.message}` }, 500);
      }
    }

    // ------------------------------------------------------------------------
    // SEGURIDAD SAAS: POST /api/terceros/rotate-key - Rotación de API Key
    // ------------------------------------------------------------------------
    if (url.pathname === '/api/terceros/rotate-key') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Método no permitido. Utiliza POST.' }, 405);
      }

      let body = {};
      try {
        body = await request.json();
      } catch {}

      const auth = await autenticarTercero(request, env, body);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      // Generar una clave segura aleatoria
      const nuevaKey = `alpha-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

      try {
        await env.DB.prepare('UPDATE terceros SET api_key = ? WHERE id = ?').bind(nuevaKey, tercero.id).run();

        return jsonResponse({
          exito: true,
          mensaje: 'API Key rotada con éxito. Actualiza tus sistemas e integraciones.',
          tercero: tercero.nombre,
          nueva_api_key: nuevaKey
        });
      } catch (err) {
        return jsonResponse({ error: `Error rotando API Key: ${err.message}` }, 500);
      }
    }

    // ------------------------------------------------------------------------
    // RF3: PUT /api/revoke/:id - Revocación de acceso o incidente
    // ------------------------------------------------------------------------
    const revokeMatch = url.pathname.match(/^\/api\/revoke\/(\d+)$/);
    if (revokeMatch) {
      if (request.method !== 'PUT') {
        return jsonResponse({ error: 'Método no permitido. Utiliza PUT.' }, 405);
      }

      const reporteId = parseInt(revokeMatch[1], 10);
      const auth = await autenticarTercero(request, env);
      if (auth.error) {
        return jsonResponse({ error: auth.error }, auth.status);
      }
      const tercero = auth.tercero;

      try {
        const updateRes = await env.DB.prepare(
          'UPDATE reportes SET estado = ? WHERE id = ? AND tercero_id = ?'
        ).bind('REVOCADO', reporteId, tercero.id).run();

        if (updateRes.meta.changes === 0) {
          return jsonResponse({ error: `Reporte #${reporteId} no encontrado o no pertenece a tu cuenta.` }, 404);
        }

        return jsonResponse({
          exito: true,
          mensaje: 'Reporte revocado exitosamente.',
          reporte_id: reporteId,
          nuevo_estado: 'REVOCADO'
        });
      } catch (err) {
        return jsonResponse({ error: `Error al revocar reporte: ${err.message}` }, 500);
      }
    }

    // ========================================================================
    // RUTAS DE PRODUCCIÓN PARA EL PANEL SAAS DE ADMINISTRADOR
    // ========================================================================

    // 1. Login de Administrador contra D1 (Usuario Genérico: admin@cazaphish.com / Admin2026*)
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      await asegurarEsquemaBase(env);
      const { usuario, password } = await request.json().catch(() => ({}));

      if (!usuario || !password) {
        return jsonResponse({ exito: false, error: 'Ingresa usuario y contraseña.' }, 400);
      }

      try {
        const admin = await env.DB.prepare(
          'SELECT id, nombre, usuario, rol, activo FROM administradores WHERE usuario = ? AND password = ?'
        ).bind(usuario.trim(), password.trim()).first();

        if (!admin || !admin.activo) {
          await registrarLogAcceso(env, usuario.trim(), 'NO_AUTORIZADO', 'Intento fallido de inicio de sesión Admin', 'DENEGADO');
          return jsonResponse({ exito: false, error: 'Credenciales de administrador inválidas.' }, 401);
        }

        await registrarLogAcceso(env, admin.usuario, admin.rol, 'Inicio de sesión en Panel SaaS', 'PERMITIDO');
        return jsonResponse({
          exito: true,
          admin: {
            id: admin.id,
            nombre: admin.nombre,
            usuario: admin.usuario,
            rol: admin.rol
          }
        });
      } catch (err) {
        return jsonResponse({ exito: false, error: err.message }, 500);
      }
    }

    // 2. Obtener vista completa del Panel SaaS (Terceros/APIs, Reportes y Log de Accesos)
    if (url.pathname === '/api/admin/overview' && request.method === 'GET') {
      await asegurarEsquemaBase(env);
      try {
        const { results: terceros } = await env.DB.prepare(`
          SELECT t.id, t.nombre, t.api_key, t.activo,
                 (SELECT COUNT(*) FROM reportes r WHERE r.tercero_id = t.id) AS total_uso
          FROM terceros t
          ORDER BY t.id DESC
        `).all();

        const { results: logs } = await env.DB.prepare(`
          SELECT id, usuario, rol, accion, estado, fecha
          FROM access_logs
          ORDER BY id DESC LIMIT 200
        `).all();

        const { results: reportesRaw } = await env.DB.prepare(`
          SELECT r.id, r.texto_original, r.veredicto_ia, r.estado, r.fecha, t.nombre AS tercero_nombre
          FROM reportes r
          LEFT JOIN terceros t ON t.id = r.tercero_id
          ORDER BY r.id DESC LIMIT 200
        `).all();

        const reportes = (reportesRaw || []).map(r => {
          let v = {};
          try { v = JSON.parse(r.veredicto_ia); } catch {}
          return {
            id: r.id,
            tercero: r.tercero_nombre || 'Tercero',
            texto_anonimizado: r.texto_original,
            riesgo: v.riesgo || 'MEDIO',
            estado: r.estado,
            fecha: r.fecha
          };
        });

        return jsonResponse({
          exito: true,
          terceros: terceros || [],
          access_logs: logs || [],
          reportes
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 3. Crear nuevo Usuario Tercero y generar su API Key en tabla `terceros`
    if (url.pathname === '/api/admin/terceros' && request.method === 'POST') {
      await asegurarEsquemaBase(env);
      const { nombre } = await request.json().catch(() => ({}));
      if (!nombre || !nombre.trim()) {
        return jsonResponse({ error: 'El nombre del servicio o usuario tercero es obligatorio.' }, 400);
      }

      const nuevaApiKey = `alpha-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      try {
        await env.DB.prepare(
          'INSERT INTO terceros (nombre, api_key, activo) VALUES (?, ?, 1)'
        ).bind(nombre.trim(), nuevaApiKey).run();

        await registrarLogAcceso(env, 'admin@cazaphish.com', 'ADMINISTRADOR', `Generó API Key para tercero: ${nombre.trim()}`, 'CREADO');

        return jsonResponse({
          exito: true,
          nombre: nombre.trim(),
          api_key: nuevaApiKey
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 4. Revocar o Reactivar el acceso de un Tercero (cambia `activo` 0 / 1 en tabla `terceros`)
    if (url.pathname === '/api/admin/terceros/toggle' && request.method === 'PUT') {
      await asegurarEsquemaBase(env);
      const { id, activo } = await request.json().catch(() => ({}));
      const nuevoEstado = activo ? 1 : 0;

      try {
        const tercero = await env.DB.prepare('SELECT nombre FROM terceros WHERE id = ?').bind(id).first();
        await env.DB.prepare('UPDATE terceros SET activo = ? WHERE id = ?').bind(nuevoEstado, id).run();

        await registrarLogAcceso(
          env,
          'admin@cazaphish.com',
          'ADMINISTRADOR',
          `${nuevoEstado ? 'Reactivó' : 'Revocó'} API Key de: ${tercero?.nombre || 'Servicio Tercero'}`,
          nuevoEstado ? 'ACTIVO' : 'REVOCADO'
        );

        return jsonResponse({ exito: true, id, activo: nuevoEstado });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 5. Revocar un reporte desde el Panel SaaS Admin (sin número de reporte en el evento)
    if (url.pathname === '/api/admin/reportes/revoke' && request.method === 'PUT') {
      await asegurarEsquemaBase(env);
      const { id } = await request.json().catch(() => ({}));
      try {
        await env.DB.prepare('UPDATE reportes SET estado = ? WHERE id = ?').bind('REVOCADO', id).run();
        await registrarLogAcceso(env, 'admin@cazaphish.com', 'ADMINISTRADOR', 'Revocó incidente de correo analizado', 'REVOCADO');
        return jsonResponse({ exito: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // Servir frontend estático (public/index.html)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Ruta por defecto si no hace match con ninguna API
    return jsonResponse({ error: 'Ruta no encontrada', status: 404 }, 404);
  }
};