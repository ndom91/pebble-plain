#include <pebble.h>

#define ROW_COUNT 5
#define HEADER_HEIGHT 28
#define LIST_ROW_COUNT 5
#define DETAIL_ROW_COUNT 7

typedef enum {
  ViewList,
  ViewDetail,
} View;

typedef struct {
  const char *ref;
  const char *title;
} ThreadRow;

typedef struct {
  const char *key;
  const char *value;
} DetailRow;

static Window *s_window;
static Layer *s_canvas_layer;
static GFont s_header_font;
static GFont s_list_font;
static GFont s_detail_key_font;
static GFont s_detail_value_font;
static View s_view = ViewList;
static int s_selected_index;
static int s_first_visible_index;
static int s_detail_selected_index;
static int s_detail_offset;

static const ThreadRow s_placeholder_threads[LIST_ROW_COUNT] = {
  {"T-562", "Slack message in #ext-plain-dev"},
  {"T-564", "Customer waiting for billing details"},
  {"T-571", "Webhook retry needs follow-up"},
  {"T-573", "API token rotation question"},
  {"T-580", "Round display layout check"},
};

static const DetailRow s_placeholder_detail[DETAIL_ROW_COUNT] = {
  {"Title", "Slack message in #ext-plain-dev"},
  {"From", "Nico (ndo.dev)"},
  {"Created", "2026-04-23"},
  {"Priority", "P2"},
  {"Labels", "The Old Guard"},
  {"Assignee", "Unassigned"},
  {"Message", "Native C placeholder shell"},
};

static GColor accent_color(void) {
  return PBL_IF_COLOR_ELSE(GColorFromRGB(0x55, 0xd6, 0xbe), GColorWhite);
}

static GColor background_color(void) {
  return PBL_IF_COLOR_ELSE(GColorFromRGB(0x07, 0x10, 0x18), GColorBlack);
}

static void draw_text(GContext *ctx, const char *text, GFont font, GRect box, GTextAlignment alignment) {
  graphics_draw_text(ctx, text, font, box, GTextOverflowModeTrailingEllipsis, alignment, NULL);
}

static void mark_dirty(void) {
  if (s_canvas_layer) {
    layer_mark_dirty(s_canvas_layer);
  }
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

static void clamp_list_selection(void) {
  if (s_selected_index < 0) {
    s_selected_index = 0;
  } else if (s_selected_index >= LIST_ROW_COUNT) {
    s_selected_index = LIST_ROW_COUNT - 1;
  }

  if (s_selected_index < s_first_visible_index) {
    s_first_visible_index = s_selected_index;
  } else if (s_selected_index >= s_first_visible_index + ROW_COUNT) {
    s_first_visible_index = s_selected_index - ROW_COUNT + 1;
  }
}

static void clamp_detail_selection(void) {
  if (s_detail_selected_index < 0) {
    s_detail_selected_index = 0;
  } else if (s_detail_selected_index >= DETAIL_ROW_COUNT) {
    s_detail_selected_index = DETAIL_ROW_COUNT - 1;
  }

  if (s_detail_selected_index < s_detail_offset) {
    s_detail_offset = s_detail_selected_index;
  } else if (s_detail_selected_index >= s_detail_offset + ROW_COUNT) {
    s_detail_offset = s_detail_selected_index - ROW_COUNT + 1;
  }
}

static void draw_header(GContext *ctx, GRect bounds) {
  graphics_context_set_text_color(ctx, accent_color());
  const char *text = s_view == ViewList ? "TODO 1/5" : "T-562 TODO P2";
  draw_text(ctx, text, s_header_font, GRect(0, 4, bounds.size.w, HEADER_HEIGHT - 4), GTextAlignmentCenter);
}

static void draw_list_row(GContext *ctx, GRect row_frame, GRect content_frame, int thread_index, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  char row_text[96];
  snprintf(row_text, sizeof(row_text), "%s %s", s_placeholder_threads[thread_index].ref, s_placeholder_threads[thread_index].title);
  draw_text(ctx, row_text, s_list_font, GRect(content_frame.origin.x + 6, content_frame.origin.y + 6, content_frame.size.w - 12, content_frame.size.h - 6), GTextAlignmentLeft);
}

static void draw_detail_row(GContext *ctx, GRect row_frame, GRect content_frame, int detail_index, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, accent_color());
    graphics_fill_rect(ctx, row_frame, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
  } else {
    graphics_context_set_text_color(ctx, GColorWhite);
  }

  const DetailRow *row = &s_placeholder_detail[detail_index];
  GRect key_frame = GRect(content_frame.origin.x + 8, content_frame.origin.y + 3, content_frame.size.w - 14, 16);
  GRect value_frame = GRect(content_frame.origin.x + 8, content_frame.origin.y + 19, content_frame.size.w - 14, content_frame.size.h - 18);
  draw_text(ctx, row->key, s_detail_key_font, key_frame, GTextAlignmentLeft);
  draw_text(ctx, row->value, s_detail_value_font, value_frame, GTextAlignmentLeft);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, background_color());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  draw_header(ctx, bounds);

  int row_height = (bounds.size.h - HEADER_HEIGHT) / ROW_COUNT;
  for (int i = 0; i < ROW_COUNT; i += 1) {
    GRect row_frame = GRect(0, HEADER_HEIGHT + i * row_height, bounds.size.w, row_height);
    GRect content_frame = row_content_frame(row_frame, i);
    if (s_view == ViewList) {
      int thread_index = s_first_visible_index + i;
      if (thread_index < LIST_ROW_COUNT) {
        draw_list_row(ctx, row_frame, content_frame, thread_index, thread_index == s_selected_index);
      }
    } else {
      int detail_index = s_detail_offset + i;
      if (detail_index < DETAIL_ROW_COUNT) {
        draw_detail_row(ctx, row_frame, content_frame, detail_index, detail_index == s_detail_selected_index);
      }
    }
  }
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewDetail) {
    s_detail_selected_index -= 1;
    clamp_detail_selection();
  } else {
    s_selected_index -= 1;
    clamp_list_selection();
  }
  mark_dirty();
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewDetail) {
    s_detail_selected_index += 1;
    clamp_detail_selection();
  } else {
    s_selected_index += 1;
    clamp_list_selection();
  }
  mark_dirty();
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewList) {
    s_view = ViewDetail;
    s_detail_selected_index = 0;
    s_detail_offset = 0;
    mark_dirty();
  }
}

static void back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view == ViewDetail) {
    s_view = ViewList;
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
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
