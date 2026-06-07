#include <pebble.h>
#include "message_keys.auto.h"

#define ROW_COUNT 5
#define HEADER_HEIGHT 28
#define MAX_THREADS 10
#define MAX_DETAIL_ROWS 12
#define MAX_MESSAGES 5
#define REF_LEN 17
#define TITLE_LEN 73
#define DETAIL_KEY_LEN 17
#define DETAIL_VALUE_LEN 73
#define MESSAGE_AUTHOR_LEN 33
#define MESSAGE_SENT_LEN 17
#define MESSAGE_VALUE_LEN 161
#define STATUS_LEN 49
#define EMPTY_TEXT_LEN 73
#define PENDING_ID_LEN 4
#define INBOX_SIZE 2048
#define OUTBOX_SIZE 128
#define MARQUEE_INTERVAL_MS 650
#define MARQUEE_PAUSE_TICKS 1
#define LIST_MARQUEE_WINDOW 24
#define DETAIL_MARQUEE_WINDOW 30
#define FIELD_SEPARATOR '\x1f'
#define RECORD_SEPARATOR '\x1e'

typedef enum {
  ViewList,
  ViewDetail,
  ViewMessages,
  ViewMessageDetail,
} View;

typedef struct {
  char ref[REF_LEN];
  char title[TITLE_LEN];
} ThreadRow;

typedef struct {
  char key[DETAIL_KEY_LEN];
  char value[DETAIL_VALUE_LEN];
} DetailRow;

typedef struct {
  char author[MESSAGE_AUTHOR_LEN];
  char sent_at[MESSAGE_SENT_LEN];
  char text[MESSAGE_VALUE_LEN];
} MessageRow;

static Window *s_window;
static Layer *s_canvas_layer;
static AppTimer *s_marquee_timer;
static GFont s_header_font;
static GFont s_list_font;
static GFont s_detail_key_font;
static GFont s_detail_value_font;
static View s_view = ViewList;
static ThreadRow s_threads[MAX_THREADS];
static DetailRow s_detail_rows[MAX_DETAIL_ROWS];
static MessageRow s_messages[MAX_MESSAGES];
static char s_thread_ref[REF_LEN];
static char s_status[STATUS_LEN] = "Loading";
static char s_empty_text[EMPTY_TEXT_LEN] = "Loading threads...";
static char s_pending_thread_index[PENDING_ID_LEN];
static char s_parse_buffer[INBOX_SIZE];
static int s_thread_count;
static int s_detail_count;
static int s_message_count;
static int s_selected_index;
static int s_first_visible_index;
static int s_detail_selected_index;
static int s_detail_offset;
static int s_message_selected_index;
static int s_message_offset;
static int s_marquee_index;
static int s_marquee_pause;

static GColor accent_color(void) {
  return PBL_IF_COLOR_ELSE(GColorFromRGB(0x55, 0xd6, 0xbe), GColorWhite);
}

static GColor background_color(void) {
  return PBL_IF_COLOR_ELSE(GColorFromRGB(0x07, 0x10, 0x18), GColorBlack);
}

static void draw_text(GContext *ctx, const char *text, GFont font, GRect box, GTextAlignment alignment) {
  graphics_draw_text(ctx, text, font, box, GTextOverflowModeTrailingEllipsis, alignment, NULL);
}

static void copy_text(char *dest, size_t dest_size, const char *source) {
  if (dest_size == 0) {
    return;
  }

  if (!source) {
    dest[0] = '\0';
    return;
  }

  strncpy(dest, source, dest_size - 1);
  dest[dest_size - 1] = '\0';
}

static void mark_dirty(void) {
  if (s_canvas_layer) {
    layer_mark_dirty(s_canvas_layer);
  }
}

static void reset_marquee(void) {
  s_marquee_index = 0;
  s_marquee_pause = MARQUEE_PAUSE_TICKS;
}

static bool selected_text_overflows(void) {
  if (s_view == ViewList && s_thread_count > 0) {
    ThreadRow *row = &s_threads[s_selected_index];
    return (int)(strlen(row->ref) + 1 + strlen(row->title)) > LIST_MARQUEE_WINDOW;
  }

  if (s_view == ViewDetail && s_detail_count > 0 && s_detail_selected_index < s_detail_count) {
    return (int)strlen(s_detail_rows[s_detail_selected_index].value) > DETAIL_MARQUEE_WINDOW;
  }

  if (s_view == ViewMessages && s_message_count > 0) {
    return (int)strlen(s_messages[s_message_selected_index].text) > DETAIL_MARQUEE_WINDOW;
  }

  return false;
}

static void marquee_text(const char *text, char *dest, size_t dest_size, int window) {
  int text_length = strlen(text);
  if (text_length <= window) {
    copy_text(dest, dest_size, text);
    return;
  }

  int gap_length = 3;
  int loop_length = text_length + gap_length;
  int start = s_marquee_index % loop_length;
  int limit = window < (int)dest_size - 1 ? window : (int)dest_size - 1;

  for (int i = 0; i < limit; i += 1) {
    int position = (start + i) % loop_length;
    if (position < text_length) {
      dest[i] = text[position];
    } else {
      dest[i] = ' ';
    }
  }
  dest[limit] = '\0';
}

static void marquee_timer_callback(void *context) {
  s_marquee_timer = NULL;
  if (selected_text_overflows()) {
    if (s_marquee_pause > 0) {
      s_marquee_pause -= 1;
    } else {
      s_marquee_index += 1;
      mark_dirty();
    }
  } else {
    reset_marquee();
  }

  s_marquee_timer = app_timer_register(MARQUEE_INTERVAL_MS, marquee_timer_callback, NULL);
}

static int row_content_inset(int visible_row) {
#if defined(PBL_ROUND)
  static const int insets[ROW_COUNT] = {20, 6, 4, 14, 36};
  return insets[visible_row];
#else
  return 0;
#endif
}

static GRect row_content_frame(GRect row_frame, int visible_row) {
  int inset = row_content_inset(visible_row);
  return GRect(row_frame.origin.x + inset, row_frame.origin.y, row_frame.size.w - inset * 2, row_frame.size.h);
}

static char *next_record(char **cursor) {
  if (!cursor || !*cursor) {
    return NULL;
  }

  char *record = *cursor;
  char *separator = strchr(record, RECORD_SEPARATOR);
  if (separator) {
    *separator = '\0';
    *cursor = separator + 1;
  } else {
    *cursor = NULL;
  }

  return record;
}

static char *split_field(char *record) {
  char *separator = strchr(record, FIELD_SEPARATOR);
  if (!separator) {
    return "";
  }

  *separator = '\0';
  return separator + 1;
}

static void copy_ref_from_status(const char *status) {
  char ref[REF_LEN];
  copy_text(ref, sizeof(ref), status);

  char *space = strchr(ref, ' ');
  if (space) {
    *space = '\0';
  }

  copy_text(s_thread_ref, sizeof(s_thread_ref), ref);
}

static int detail_row_count(void) {
  return s_detail_count == 0 ? 0 : s_detail_count + 1;
}

static void clamp_list_selection(void) {
  if (s_thread_count == 0) {
    s_selected_index = 0;
    s_first_visible_index = 0;
    return;
  }

  if (s_selected_index < 0) {
    s_selected_index = 0;
  } else if (s_selected_index >= s_thread_count) {
    s_selected_index = s_thread_count - 1;
  }

  if (s_selected_index < s_first_visible_index) {
    s_first_visible_index = s_selected_index;
  } else if (s_selected_index >= s_first_visible_index + ROW_COUNT) {
    s_first_visible_index = s_selected_index - ROW_COUNT + 1;
  }
}

static void clamp_detail_selection(void) {
  int rows = detail_row_count();
  if (rows == 0) {
    s_detail_selected_index = 0;
    s_detail_offset = 0;
    return;
  }

  if (s_detail_selected_index < 0) {
    s_detail_selected_index = 0;
  } else if (s_detail_selected_index >= rows) {
    s_detail_selected_index = rows - 1;
  }

  if (s_detail_selected_index < s_detail_offset) {
    s_detail_offset = s_detail_selected_index;
  } else if (s_detail_selected_index >= s_detail_offset + ROW_COUNT) {
    s_detail_offset = s_detail_selected_index - ROW_COUNT + 1;
  }
}

static void clamp_message_selection(void) {
  if (s_message_count == 0) {
    s_message_selected_index = 0;
    s_message_offset = 0;
    return;
  }

  if (s_message_selected_index < 0) {
    s_message_selected_index = 0;
  } else if (s_message_selected_index >= s_message_count) {
    s_message_selected_index = s_message_count - 1;
  }

  if (s_message_selected_index < s_message_offset) {
    s_message_offset = s_message_selected_index;
  } else if (s_message_selected_index >= s_message_offset + ROW_COUNT) {
    s_message_offset = s_message_selected_index - ROW_COUNT + 1;
  }
}

static void move_list_selection(int delta) {
  if (s_thread_count == 0) {
    return;
  }

  s_selected_index += delta;
  if (s_selected_index < 0) {
    s_selected_index = s_thread_count - 1;
  } else if (s_selected_index >= s_thread_count) {
    s_selected_index = 0;
  }

  clamp_list_selection();
}

static void move_detail_selection(int delta) {
  int rows = detail_row_count();
  if (rows == 0) {
    return;
  }

  s_detail_selected_index += delta;
  if (s_detail_selected_index < 0) {
    s_detail_selected_index = rows - 1;
  } else if (s_detail_selected_index >= rows) {
    s_detail_selected_index = 0;
  }

  clamp_detail_selection();
}

static void move_message_selection(int delta) {
  if (s_message_count == 0) {
    return;
  }

  s_message_selected_index += delta;
  if (s_message_selected_index < 0) {
    s_message_selected_index = s_message_count - 1;
  } else if (s_message_selected_index >= s_message_count) {
    s_message_selected_index = 0;
  }

  clamp_message_selection();
}

static void render_error(const char *message) {
  s_view = ViewList;
  s_pending_thread_index[0] = '\0';
  s_thread_ref[0] = '\0';
  reset_marquee();
  s_thread_count = 0;
  s_detail_count = 0;
  s_message_count = 0;
  s_selected_index = 0;
  s_first_visible_index = 0;
  s_message_selected_index = 0;
  s_message_offset = 0;
  copy_text(s_status, sizeof(s_status), "Error");
  copy_text(s_empty_text, sizeof(s_empty_text), message);
  mark_dirty();
}

static void render_detail_error(const char *message) {
  s_view = ViewDetail;
  s_detail_count = 0;
  s_message_count = 0;
  s_detail_selected_index = 0;
  s_detail_offset = 0;
  s_message_selected_index = 0;
  s_message_offset = 0;
  reset_marquee();
  copy_text(s_status, sizeof(s_status), "Thread detail");
  copy_text(s_empty_text, sizeof(s_empty_text), message);
  mark_dirty();
}

static void parse_threads(const char *payload) {
  copy_text(s_parse_buffer, sizeof(s_parse_buffer), payload);
  s_thread_count = 0;
  s_detail_count = 0;
  s_message_count = 0;
  s_selected_index = 0;
  s_first_visible_index = 0;
  s_message_selected_index = 0;
  s_message_offset = 0;
  s_view = ViewList;
  s_pending_thread_index[0] = '\0';
  reset_marquee();
  copy_text(s_status, sizeof(s_status), "TODO");
  copy_text(s_empty_text, sizeof(s_empty_text), "No TODO threads");

  char *cursor = s_parse_buffer;
  char *record;
  while ((record = next_record(&cursor)) && s_thread_count < MAX_THREADS) {
    if (record[0] == '\0') {
      continue;
    }

    char *title = split_field(record);
    copy_text(s_threads[s_thread_count].ref, sizeof(s_threads[s_thread_count].ref), record);
    copy_text(s_threads[s_thread_count].title, sizeof(s_threads[s_thread_count].title), title);
    s_thread_count += 1;
  }

  clamp_list_selection();
  mark_dirty();
}

static void parse_detail(const char *payload) {
  copy_text(s_parse_buffer, sizeof(s_parse_buffer), payload);
  char *cursor = s_parse_buffer;
  char *thread_index = next_record(&cursor);
  char *status = next_record(&cursor);

  if (!thread_index || !status || s_view != ViewDetail || s_pending_thread_index[0] == '\0' || strcmp(thread_index, s_pending_thread_index) != 0) {
    return;
  }

  s_view = ViewDetail;
  s_detail_count = 0;
  s_message_count = 0;
  s_detail_selected_index = 0;
  s_detail_offset = 0;
  s_message_selected_index = 0;
  s_message_offset = 0;
  reset_marquee();
  copy_ref_from_status(status);
  copy_text(s_empty_text, sizeof(s_empty_text), "No detail lines");

  char *record;
  while ((record = next_record(&cursor))) {
    if (record[0] == '\0') {
      continue;
    }

    char *value = split_field(record);
    if (strcmp(record, "Message") == 0) {
      if (s_message_count < MAX_MESSAGES) {
        char *sent_at = split_field(value);
        char *text = split_field(sent_at);
        copy_text(s_messages[s_message_count].author, sizeof(s_messages[s_message_count].author), value);
        copy_text(s_messages[s_message_count].sent_at, sizeof(s_messages[s_message_count].sent_at), sent_at);
        copy_text(s_messages[s_message_count].text, sizeof(s_messages[s_message_count].text), text);
        s_message_count += 1;
      }
    } else if (s_detail_count < MAX_DETAIL_ROWS) {
      copy_text(s_detail_rows[s_detail_count].key, sizeof(s_detail_rows[s_detail_count].key), record);
      copy_text(s_detail_rows[s_detail_count].value, sizeof(s_detail_rows[s_detail_count].value), value);
      s_detail_count += 1;
    }
  }

  clamp_detail_selection();
  mark_dirty();
}

static void parse_detail_error(const char *payload) {
  copy_text(s_parse_buffer, sizeof(s_parse_buffer), payload);
  char *message = split_field(s_parse_buffer);
  if (s_view == ViewDetail && s_pending_thread_index[0] != '\0' && strcmp(s_parse_buffer, s_pending_thread_index) == 0) {
    render_detail_error(message);
  }
}

static void send_thread_id(void) {
  DictionaryIterator *iterator;
  AppMessageResult result = app_message_outbox_begin(&iterator);
  if (result != APP_MSG_OK || !iterator) {
    render_detail_error("Could not request thread");
    return;
  }

  dict_write_cstring(iterator, MESSAGE_KEY_THREAD_ID, s_pending_thread_index);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    render_detail_error("Could not send request");
  }
}

static void draw_header(GContext *ctx, GRect bounds) {
  char status_text[STATUS_LEN];
  if (s_view == ViewList && s_thread_count > 0) {
    snprintf(status_text, sizeof(status_text), "TODO %d/%d", s_selected_index + 1, s_thread_count);
  } else if (s_view == ViewDetail && s_thread_ref[0] != '\0') {
    copy_text(status_text, sizeof(status_text), s_thread_ref);
  } else if (s_view == ViewMessages && s_thread_ref[0] != '\0') {
    snprintf(status_text, sizeof(status_text), "%s Messages (%d)", s_thread_ref, s_message_count);
  } else if (s_view == ViewMessageDetail && s_thread_ref[0] != '\0') {
    snprintf(status_text, sizeof(status_text), "%s Msg %d/%d", s_thread_ref, s_message_selected_index + 1, s_message_count);
  } else {
    copy_text(status_text, sizeof(status_text), s_status);
  }

  graphics_context_set_text_color(ctx, accent_color());
  draw_text(ctx, status_text, s_header_font, GRect(0, 4, bounds.size.w, HEADER_HEIGHT - 4), GTextAlignmentCenter);
}

static void draw_empty_row(GContext *ctx, GRect row_frame, GRect content_frame) {
  graphics_context_set_text_color(ctx, GColorWhite);
  draw_text(ctx, s_empty_text, s_list_font, GRect(content_frame.origin.x + 6, row_frame.origin.y + 6, content_frame.size.w - 12, row_frame.size.h - 6), GTextAlignmentLeft);
}

static void draw_list_row(GContext *ctx, GRect row_frame, GRect content_frame, int thread_index, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  char row_text[REF_LEN + TITLE_LEN + 2];
  GRect label_frame = GRect(content_frame.origin.x + 6, content_frame.origin.y + 6, content_frame.size.w - 42, content_frame.size.h - 6);
  GRect chevron_frame = GRect(content_frame.origin.x + content_frame.size.w - 30, content_frame.origin.y + 6, 22, content_frame.size.h - 6);
  snprintf(row_text, sizeof(row_text), "%s %s", s_threads[thread_index].ref, s_threads[thread_index].title);
  if (selected) {
    char marquee_row_text[REF_LEN + TITLE_LEN + 2];
    marquee_text(row_text, marquee_row_text, sizeof(marquee_row_text), LIST_MARQUEE_WINDOW);
    draw_text(ctx, marquee_row_text, s_list_font, label_frame, GTextAlignmentLeft);
  } else {
    draw_text(ctx, row_text, s_list_font, label_frame, GTextAlignmentLeft);
  }
  draw_text(ctx, ">", s_list_font, chevron_frame, GTextAlignmentRight);
}

static void draw_detail_row(GContext *ctx, GRect row_frame, GRect content_frame, int detail_index, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  DetailRow *row = &s_detail_rows[detail_index];
  GRect key_frame = GRect(content_frame.origin.x + 8, content_frame.origin.y + 1, content_frame.size.w - 14, 16);
  GRect value_frame = GRect(content_frame.origin.x + 8, content_frame.origin.y + 17, content_frame.size.w - 14, content_frame.size.h - 16);
  char value_text[DETAIL_VALUE_LEN];
  copy_text(value_text, sizeof(value_text), row->value);
  if (selected) {
    marquee_text(row->value, value_text, sizeof(value_text), DETAIL_MARQUEE_WINDOW);
  }
  draw_text(ctx, row->key, s_detail_key_font, key_frame, GTextAlignmentLeft);
  draw_text(ctx, value_text, s_detail_value_font, value_frame, GTextAlignmentLeft);
}

static void draw_messages_button_row(GContext *ctx, GRect row_frame, GRect content_frame, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  char label_text[24];
  GRect label_frame = GRect(content_frame.origin.x + 8, content_frame.origin.y + 6, content_frame.size.w - 38, content_frame.size.h - 6);
  GRect chevron_frame = GRect(content_frame.origin.x + content_frame.size.w - 30, content_frame.origin.y + 6, 22, content_frame.size.h - 6);
  snprintf(label_text, sizeof(label_text), "Messages (%d)", s_message_count);
  draw_text(ctx, label_text, s_list_font, label_frame, GTextAlignmentLeft);
  draw_text(ctx, ">", s_list_font, chevron_frame, GTextAlignmentRight);
}

static void draw_message_row(GContext *ctx, GRect row_frame, GRect content_frame, int message_index, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  char message_text[MESSAGE_VALUE_LEN];
  copy_text(message_text, sizeof(message_text), s_messages[message_index].text);
  if (selected) {
    marquee_text(s_messages[message_index].text, message_text, sizeof(message_text), DETAIL_MARQUEE_WINDOW);
  }

  draw_text(ctx, message_text, s_list_font, GRect(content_frame.origin.x + 6, content_frame.origin.y + 6, content_frame.size.w - 42, content_frame.size.h - 6), GTextAlignmentLeft);
  draw_text(ctx, ">", s_list_font, GRect(content_frame.origin.x + content_frame.size.w - 30, content_frame.origin.y + 6, 22, content_frame.size.h - 6), GTextAlignmentRight);
}

static void draw_message_detail_page(GContext *ctx, GRect bounds) {
  if (s_message_count == 0) {
    draw_empty_row(ctx, GRect(0, HEADER_HEIGHT, bounds.size.w, bounds.size.h - HEADER_HEIGHT), GRect(0, HEADER_HEIGHT, bounds.size.w, bounds.size.h - HEADER_HEIGHT));
    return;
  }

  MessageRow *message = &s_messages[s_message_selected_index];
#if defined(PBL_ROUND)
  int inset = 20;
#else
  int inset = 8;
#endif
  GRect body_frame = GRect(inset, HEADER_HEIGHT, bounds.size.w - inset * 2, bounds.size.h - HEADER_HEIGHT);
  GRect author_key_frame = GRect(body_frame.origin.x, body_frame.origin.y + 2, body_frame.size.w, 14);
  GRect author_value_frame = GRect(body_frame.origin.x, body_frame.origin.y + 16, body_frame.size.w, 20);
  GRect sent_key_frame = GRect(body_frame.origin.x, body_frame.origin.y + 39, body_frame.size.w, 14);
  GRect sent_value_frame = GRect(body_frame.origin.x, body_frame.origin.y + 53, body_frame.size.w, 20);
  GRect text_frame = GRect(body_frame.origin.x, body_frame.origin.y + 78, body_frame.size.w, body_frame.size.h - 78);

  graphics_context_set_text_color(ctx, accent_color());
  draw_text(ctx, "Author", s_detail_key_font, author_key_frame, GTextAlignmentLeft);
  draw_text(ctx, "Sent", s_detail_key_font, sent_key_frame, GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, GColorWhite);
  draw_text(ctx, message->author, s_detail_value_font, author_value_frame, GTextAlignmentLeft);
  draw_text(ctx, message->sent_at, s_detail_value_font, sent_value_frame, GTextAlignmentLeft);
  draw_text(ctx, message->text, s_detail_value_font, text_frame, GTextAlignmentLeft);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, background_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  draw_header(ctx, bounds);

  if (s_view == ViewMessageDetail) {
    draw_message_detail_page(ctx, bounds);
    return;
  }

  int row_height = (bounds.size.h - HEADER_HEIGHT) / ROW_COUNT;
  for (int i = 0; i < ROW_COUNT; i += 1) {
    GRect row_frame = GRect(0, HEADER_HEIGHT + i * row_height, bounds.size.w, row_height);
    GRect content_frame = row_content_frame(row_frame, i);
    if (s_view == ViewList) {
      if (s_thread_count == 0) {
        if (i == 0) {
          draw_empty_row(ctx, row_frame, content_frame);
        }
      } else {
        int thread_index = s_first_visible_index + i;
        if (thread_index < s_thread_count) {
          draw_list_row(ctx, row_frame, content_frame, thread_index, thread_index == s_selected_index);
        }
      }
    } else if (s_view == ViewDetail) {
      if (s_detail_count == 0) {
        if (i == 0) {
          draw_empty_row(ctx, row_frame, content_frame);
        }
      } else {
        int detail_index = s_detail_offset + i;
        if (detail_index < s_detail_count) {
          draw_detail_row(ctx, row_frame, content_frame, detail_index, detail_index == s_detail_selected_index);
        } else if (detail_index == s_detail_count) {
          draw_messages_button_row(ctx, row_frame, content_frame, detail_index == s_detail_selected_index);
        }
      }
    } else if (s_view == ViewMessages) {
      if (s_message_count == 0) {
        if (i == 0) {
          draw_empty_row(ctx, row_frame, content_frame);
        }
      } else {
        int message_index = s_message_offset + i;
        if (message_index < s_message_count) {
          draw_message_row(ctx, row_frame, content_frame, message_index, message_index == s_message_selected_index);
        }
      }
    }
  }
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewMessageDetail) {
    move_message_selection(-1);
  } else if (s_view == ViewDetail) {
    move_detail_selection(-1);
  } else if (s_view == ViewMessages) {
    move_message_selection(-1);
  } else {
    move_list_selection(-1);
  }
  reset_marquee();
  mark_dirty();
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewMessageDetail) {
    move_message_selection(1);
  } else if (s_view == ViewDetail) {
    move_detail_selection(1);
  } else if (s_view == ViewMessages) {
    move_message_selection(1);
  } else {
    move_list_selection(1);
  }
  reset_marquee();
  mark_dirty();
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewDetail) {
    if (s_detail_count > 0 && s_detail_selected_index == s_detail_count) {
      s_view = ViewMessages;
      s_message_selected_index = 0;
      s_message_offset = 0;
      copy_text(s_empty_text, sizeof(s_empty_text), "No messages");
      reset_marquee();
      mark_dirty();
    }
    return;
  }

  if (s_view == ViewMessages) {
    if (s_message_count > 0) {
      s_view = ViewMessageDetail;
      reset_marquee();
      mark_dirty();
    }
    return;
  }

  if (s_view != ViewList || s_thread_count == 0) {
    return;
  }

  s_view = ViewDetail;
  s_detail_count = 0;
  s_detail_selected_index = 0;
  s_detail_offset = 0;
  reset_marquee();
  snprintf(s_pending_thread_index, sizeof(s_pending_thread_index), "%d", s_selected_index);
  copy_text(s_thread_ref, sizeof(s_thread_ref), s_threads[s_selected_index].ref);
  copy_text(s_status, sizeof(s_status), s_thread_ref);
  copy_text(s_empty_text, sizeof(s_empty_text), "Loading detail...");
  mark_dirty();
  send_thread_id();
}

static void back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewMessageDetail) {
    s_view = ViewMessages;
    reset_marquee();
    mark_dirty();
  } else if (s_view == ViewMessages) {
    s_view = ViewDetail;
    reset_marquee();
    mark_dirty();
  } else if (s_view == ViewDetail) {
    s_view = ViewList;
    s_pending_thread_index[0] = '\0';
    reset_marquee();
    mark_dirty();
  } else {
    window_stack_pop(true);
  }
}

static void click_config_provider(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 100, up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 100, down_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, back_click_handler);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *tuple = dict_find(iterator, MESSAGE_KEY_ERROR);
  if (tuple) {
    render_error(tuple->value->cstring);
    return;
  }

  tuple = dict_find(iterator, MESSAGE_KEY_THREAD_DETAIL_ERROR);
  if (tuple) {
    parse_detail_error(tuple->value->cstring);
    return;
  }

  tuple = dict_find(iterator, MESSAGE_KEY_THREAD_DETAIL);
  if (tuple) {
    parse_detail(tuple->value->cstring);
    return;
  }

  tuple = dict_find(iterator, MESSAGE_KEY_THREADS);
  if (tuple) {
    parse_threads(tuple->value->cstring);
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  render_error("Message dropped");
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  if (s_view == ViewDetail && s_detail_count == 0) {
    render_detail_error("Request failed");
  }
}

static void window_load(Window *window) {
  Layer *root_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root_layer);
  s_canvas_layer = layer_create(bounds);
  layer_set_update_proc(s_canvas_layer, canvas_update_proc);
  layer_add_child(root_layer, s_canvas_layer);
}

static void window_unload(Window *window) {
  layer_destroy(s_canvas_layer);
  s_canvas_layer = NULL;
}

static void init(void) {
  s_header_font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  s_list_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  s_detail_key_font = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  s_detail_value_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);
  reset_marquee();
  s_marquee_timer = app_timer_register(MARQUEE_INTERVAL_MS, marquee_timer_callback, NULL);

  s_window = window_create();
  window_set_background_color(s_window, background_color());
  window_set_click_config_provider(s_window, click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

static void deinit(void) {
  if (s_marquee_timer) {
    app_timer_cancel(s_marquee_timer);
  }
  app_message_deregister_callbacks();
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
