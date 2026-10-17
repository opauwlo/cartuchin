/* RetroAchievements para o Cartuchin: o rc_client (rcheevos) compilado para WebAssembly.
   O JS fornece (Module.ra*): leitura da memória do jogo, as chamadas ao servidor (pelo
   /api/ra do próprio site) e recebe os eventos (conquista desbloqueada etc.).
   Só modo casual (softcore): o modo hardcore exige emulador aprovado pelo RA. */
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "rc_client.h"
#include "rc_consoles.h"
#include "../src/util/md5.h"

static rc_client_t *client;
static char out[65536];

EM_JS(uint32_t, js_read, (uint32_t addr, uint8_t *buf, uint32_t n), { return Module.raRead(addr, buf, n); });
EM_JS(void, js_server, (const char *url, const char *post, const char *ctype, int cb, int cbdata), {
  Module.raServer(UTF8ToString(url), post ? UTF8ToString(post) : null, ctype ? UTF8ToString(ctype) : null, cb, cbdata);
});
EM_JS(void, js_event, (int type, uint32_t id, const char *json), { Module.raEvent(type, id, UTF8ToString(json)); });
EM_JS(void, js_done, (int kind, int result, const char *msg), { Module.raDone(kind, result, msg ? UTF8ToString(msg) : ""); });
EM_JS(void, js_log, (const char *msg), { if (Module.raLog) Module.raLog(UTF8ToString(msg)); });

static uint32_t read_mem(uint32_t a, uint8_t *b, uint32_t n, rc_client_t *c) { (void)c; return js_read(a, b, n); }
static void server_call(const rc_api_request_t *req, rc_client_server_callback_t cb, void *cbdata, rc_client_t *c) {
  (void)c;
  js_server(req->url, req->post_data, req->content_type, (int)(intptr_t)cb, (int)(intptr_t)cbdata);
}
EMSCRIPTEN_KEEPALIVE void ra_response(int cb, int cbdata, const char *body, int len, int status) {
  rc_api_server_response_t r;
  r.body = body;
  r.body_length = (size_t)len;
  r.http_status_code = status;
  ((rc_client_server_callback_t)(intptr_t)cb)(&r, (void *)(intptr_t)cbdata);
}

/* ---- JSON (só o que o app usa) ---- */
static size_t put(size_t p, const char *s) {
  size_t n = strlen(s);
  if (p + n + 1 >= sizeof(out)) return p;
  memcpy(out + p, s, n);
  out[p + n] = 0;
  return p + n;
}
static size_t put_str(size_t p, const char *s) {
  char esc[8];
  p = put(p, "\"");
  for (; s && *s && p < sizeof(out) - 16; s++) {
    unsigned char ch = (unsigned char)*s;
    if (ch == '"' || ch == '\\') { esc[0] = '\\'; esc[1] = (char)ch; esc[2] = 0; p = put(p, esc); }
    else if (ch < 0x20) { snprintf(esc, sizeof esc, "\\u%04x", ch); p = put(p, esc); }
    else { esc[0] = (char)ch; esc[1] = 0; p = put(p, esc); }
  }
  return put(p, "\"");
}
static size_t put_num(size_t p, double v) { char b[32]; snprintf(b, sizeof b, "%.10g", v); return put(p, b); }
static size_t put_ach(size_t p, const rc_client_achievement_t *a) {
  p = put(p, "{\"id\":"); p = put_num(p, a->id);
  p = put(p, ",\"title\":"); p = put_str(p, a->title);
  p = put(p, ",\"description\":"); p = put_str(p, a->description);
  p = put(p, ",\"points\":"); p = put_num(p, a->points);
  p = put(p, ",\"unlocked\":"); p = put_num(p, a->unlocked);
  p = put(p, ",\"unlockTime\":"); p = put_num(p, (double)a->unlock_time);
  p = put(p, ",\"bucket\":"); p = put_num(p, a->bucket);
  p = put(p, ",\"progress\":"); p = put_str(p, a->measured_progress);
  p = put(p, ",\"percent\":"); p = put_num(p, a->measured_percent);
  p = put(p, ",\"rarity\":"); p = put_num(p, a->rarity);
  p = put(p, ",\"badge\":"); p = put_str(p, a->badge_url ? a->badge_url : "");
  p = put(p, ",\"badgeLocked\":"); p = put_str(p, a->badge_locked_url ? a->badge_locked_url : "");
  return put(p, "}");
}

static void on_event(const rc_client_event_t *e, rc_client_t *c) {
  (void)c;
  size_t p = 0;
  out[0] = 0;
  if (e->achievement) p = put_ach(p, e->achievement);
  else if (e->server_error) { p = put(p, "{\"error\":"); p = put_str(p, e->server_error->error_message); p = put(p, "}"); }
  js_event((int)e->type, e->achievement ? e->achievement->id : 0, out);
}
static void log_msg(const char *m, const rc_client_t *c) { (void)c; js_log(m); }

EMSCRIPTEN_KEEPALIVE int ra_init(void) {
  if (client) return 1;
  client = rc_client_create(read_mem, server_call);
  if (!client) return 0;
  rc_client_set_event_handler(client, on_event);
  rc_client_enable_logging(client, RC_CLIENT_LOG_LEVEL_WARN, log_msg);
  rc_client_set_hardcore_enabled(client, 0);
  return 1;
}

static void login_cb(int result, const char *msg, rc_client_t *c, void *ud) { (void)c; (void)ud; js_done(1, result, msg); }
EMSCRIPTEN_KEEPALIVE void ra_login_password(const char *user, const char *pass) { rc_client_begin_login_with_password(client, user, pass, login_cb, NULL); }
EMSCRIPTEN_KEEPALIVE void ra_login_token(const char *user, const char *token) { rc_client_begin_login_with_token(client, user, token, login_cb, NULL); }
EMSCRIPTEN_KEEPALIVE void ra_logout(void) { rc_client_logout(client); }
EMSCRIPTEN_KEEPALIVE const char *ra_user_json(void) {
  const rc_client_user_t *u = rc_client_get_user_info(client);
  size_t p = 0;
  out[0] = 0;
  if (!u) return put(0, "null") ? out : out;
  p = put(p, "{\"name\":"); p = put_str(p, u->display_name);
  p = put(p, ",\"username\":"); p = put_str(p, u->username);
  p = put(p, ",\"token\":"); p = put_str(p, u->token);
  p = put(p, ",\"score\":"); p = put_num(p, u->score_casual);
  p = put(p, ",\"avatar\":"); p = put_str(p, u->avatar_url ? u->avatar_url : "");
  put(p, "}");
  return out;
}

static void load_cb(int result, const char *msg, rc_client_t *c, void *ud) { (void)c; (void)ud; js_done(2, result, msg); }
EMSCRIPTEN_KEEPALIVE void ra_load_game(const char *hash) { rc_client_begin_load_game(client, hash, load_cb, NULL); }
EMSCRIPTEN_KEEPALIVE void ra_unload_game(void) { rc_client_unload_game(client); }
EMSCRIPTEN_KEEPALIVE void ra_do_frame(void) { rc_client_do_frame(client); }
EMSCRIPTEN_KEEPALIVE void ra_idle(void) { rc_client_idle(client); }
EMSCRIPTEN_KEEPALIVE const char *ra_game_json(void) {
  const rc_client_game_t *g = rc_client_get_game_info(client);
  rc_client_user_game_summary_t s;
  size_t p = 0;
  out[0] = 0;
  if (!g) { put(0, "null"); return out; }
  memset(&s, 0, sizeof s);
  rc_client_get_user_game_summary(client, &s);
  p = put(p, "{\"id\":"); p = put_num(p, g->id);
  p = put(p, ",\"title\":"); p = put_str(p, g->title);
  p = put(p, ",\"badge\":"); p = put_str(p, g->badge_url ? g->badge_url : "");
  p = put(p, ",\"total\":"); p = put_num(p, s.num_promoted_achievements);
  p = put(p, ",\"unlocked\":"); p = put_num(p, s.num_unlocked_achievements);
  p = put(p, ",\"points\":"); p = put_num(p, s.points_available);
  p = put(p, ",\"pointsUnlocked\":"); p = put_num(p, s.points_unlocked);
  put(p, "}");
  return out;
}
EMSCRIPTEN_KEEPALIVE const char *ra_achievements_json(void) {
  rc_client_achievement_list_t *list = rc_client_create_achievement_list(client, RC_CLIENT_ACHIEVEMENT_CATEGORY_PROMOTED, RC_CLIENT_ACHIEVEMENT_LIST_GROUPING_LOCK_STATE);
  size_t p = put(0, "[");
  int first = 1;
  if (list) {
    for (uint32_t b = 0; b < list->num_buckets; b++)
      for (uint32_t i = 0; i < list->buckets[b].num_achievements; i++) {
        if (!first) p = put(p, ",");
        first = 0;
        p = put_ach(p, list->buckets[b].achievements[i]);
      }
    rc_client_destroy_achievement_list(list);
  }
  put(p, "]");
  return out;
}

/* MD5 incremental: o JS calcula o hash do jogo (GBA: arquivo inteiro; DS: cabeçalho + códigos + ícone) */
EMSCRIPTEN_KEEPALIVE md5_state_t *ra_md5_new(void) { md5_state_t *s = (md5_state_t *)malloc(sizeof(md5_state_t)); md5_init(s); return s; }
EMSCRIPTEN_KEEPALIVE void ra_md5_append(md5_state_t *s, const uint8_t *d, int n) { md5_append(s, d, n); }
EMSCRIPTEN_KEEPALIVE void ra_md5_finish(md5_state_t *s, uint8_t *digest) { md5_finish(s, digest); free(s); }
