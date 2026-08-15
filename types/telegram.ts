// Telegram WebApp, InitData типы
// Types for Telegram Web App integration

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code: string;
}

export interface TelegramInitData {
  query_id?: string;
  user?: TelegramUser;
  receiver?: TelegramUser;
  chat_type?: 'sender' | 'private' | 'group' | 'supergroup';
  chat_instance?: string;
  auth_date?: string;
  hash?: string;
}

export interface TelegramWebAppData {
  initData: string;
  initDataUnparsed: string;
}

export interface TelegramMainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
}

export interface TelegramBackButton {
  isVisible: boolean;
}

// ============================================================================
// Telegram Bot API 10.2+ Types
// ============================================================================

/** Base response from Telegram Bot API */
export interface BotAPIResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    migrate_to_chat_id?: number;
    retry_after?: number;
  };
}

/** Error response from Telegram Bot API */
export interface BotAPIError {
  ok: false;
  error_code: number;
  description: string;
  parameters?: {
    retry_after?: number;
  };
}

/** Inline keyboard markup */
export interface InlineKeyboardMarkup {
  inline_keyboard?: Array<Array<InlineKeyboardButton>>;
}

/** Reply keyboard markup */
export interface ReplyKeyboardMarkup {
  keyboard?: Array<Array<KeyboardButton>>;
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
}

/** Inline keyboard button */
export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
  login_url?: { url: string; forward_text?: string; bot_username?: string; request_write_access?: boolean };
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
}

/** Regular keyboard button */
export interface KeyboardButton {
  text: string;
  web_app?: { url: string };
  request_users?: { user_id: number; request_access: string };
  request_chat?: { chat_id: number; request_access: string };
}

/** Telegram Message object */
export interface Message {
  message_id: number;
  date: number;
  chat: Chat;
  from?: User;
  sender_chat?: Chat;
  reply_to_message?: Message;
  via_bot?: User;
  edit_date?: number;
  text?: string;
  entities?: MessageEntity[];
  caption?: string;
  caption_entities?: MessageEntity[];
  audio?: Audio;
  document?: Document;
  animation?: Animation;
  game?: Game;
  photo?: PhotoSize[];
  sticker?: Sticker;
  video?: Video;
  voice?: Voice;
  video_note?: VideoNote;
  contact?: Contact;
  location?: Location;
  venue?: Venue;
  poll?: Poll;
  new_chat_members?: User[];
  left_chat_member?: User;
  new_chat_title?: string;
  new_chat_photo?: PhotoSize[];
  delete_chat_photo?: boolean;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  channel_chat_created?: boolean;
  mssisage_auto_delete_timer_changed?: MessageAutoDeleteTimerChanged;
  proximity_alert_triggered?: ProximityAlertTriggered;
  reply_markup?: InlineKeyboardMarkup;
  /** Ephemeral message ID (Bot API 10.2+) */
  ephemeral_message_id?: number;
  /** Ephemeral message expiration timestamp (Bot API 10.2+) */
  expire_date?: number;
  /** User who receives ephemeral message (Bot API 10.2+) */
  receiver_user?: User;
}

/** Chat object */
export interface Chat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo?: ChatPhoto;
  bio?: string;
  description?: string;
  invite_link?: string;
  pinned_message?: Message;
  permissions?: ChatPermissions;
  slow_mode_delay?: number;
  sticker_set_name?: string;
  can_set_sticker_set?: boolean;
  /** Chat ID for successful migration (Bot API 10.2+) */
  migrate_to?: number;
  /** Chat ID from which chat migrated (Bot API 10.2+) */
  migrate_from?: number;
}

/** User object */
export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

/** Chat photo */
export interface ChatPhoto {
  small_file_id: string;
  small_file_unique_id: string;
  big_file_id: string;
  big_file_unique_id: string;
}

/** Chat permissions */
export interface ChatPermissions {
  can_send_messages?: boolean;
  can_send_audios?: boolean;
  can_send_documents?: boolean;
  can_send_photos?: boolean;
  can_send_videos?: boolean;
  can_send_video_notes?: boolean;
  can_send_voice_notes?: boolean;
  can_send_polls?: boolean;
  can_send_other_messages?: boolean;
  can_add_web_page_previews?: boolean;
  can_change_info?: boolean;
  can_invite_users?: boolean;
  can_pin_messages?: boolean;
  can_manage_topics?: boolean;
}

/** Message entity (bold, italic, etc.) */
export interface MessageEntity {
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'pre' | 'text_link' | 'text_mention' | 'custom_emoji';
  offset: number;
  length: number;
  url?: string;
  user?: User;
  language?: string;
  custom_emoji_id?: string;
}

/** Audio object */
export interface Audio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Document object */
export interface Document {
  file_id: string;
  file_unique_id: string;
  thumbnail?: PhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Animation object */
export interface Animation {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: PhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Game object */
export interface Game {
  title: string;
  text: string;
  text_entities?: MessageEntity[];
  photo?: PhotoSize[];
  video?: Video;
  audio?: Audio;
  text_animation?: Animation;
}

/** Photo size object */
export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Sticker object */
export interface Sticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated?: boolean;
  is_video?: boolean;
  thumbnail?: PhotoSize;
  emoji?: string;
  set_name?: string;
  premium_animation?: Animation;
  mask_position?: MaskPosition;
  custom_emoji_id?: string;
}

/** Voice object */
export interface Voice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/** Video object */
export interface Video {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: PhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/** Video note object */
export interface VideoNote {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  thumbnail?: PhotoSize;
  file_size?: number;
}

/** Contact object */
export interface Contact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
}

/** Location object */
export interface Location {
  longitude: number;
  latitude: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
}

/** Venue object */
export interface Venue {
  location: Location;
  title: string;
  address: string;
  foursquare_id?: string;
  foursquare_type?: string;
  google_place_id?: string;
  google_place_type?: string;
}

/** Poll object */
export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: 'regular' | 'quiz';
  allows_multiple_answers?: boolean;
  correct_option_id?: number;
  explanation?: string;
  explanation_entities?: MessageEntity[];
  open_period?: number;
  close_date?: number;
}

/** Poll option */
export interface PollOption {
  text: string;
  voter_count: number;
}

/** Mask position */
export interface MaskPosition {
  point: 'forehead' | 'nose' | 'cheek_left' | 'cheek_right' | 'mouth';
  x_shift: number;
  y_shift: number;
  scale: number;
}

/** Update object (incoming webhook payload) */
export interface Update {
  update_id: number;
  message?: Message;
  edited_message?: Message;
  channel_post?: Message;
  edited_channel_post?: Message;
  callback_query?: CallbackQuery;
  inline_query?: InlineQuery;
  chosen_inline_result?: ChosenInlineResult;
}

/** Callback query */
export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

/** Inline query */
export interface InlineQuery {
  id: string;
  from: User;
  query: string;
  offset: string;
  chat_type?: 'sender' | 'private' | 'group' | 'supergroup' | 'channel';
  location?: Location;
}

/** Chosen inline result */
export interface ChosenInlineResult {
  result_id: string;
  from: User;
  location?: Location;
  inline_message_id?: string;
  query: string;
}

/** Auto-delete timer changed */
export interface MessageAutoDeleteTimerChanged {
  message_auto_delete_time: number;
}

/** Proximity alert triggered */
export interface ProximityAlertTriggered {
  traveler: User;
  watcher: User;
  distance: number;
}

// ============================================================================
// Rich Messages (Bot API 10.1+)
// ============================================================================

/** HTML whitelist tags for Telegram rich messages */
export const RICH_MESSAGE_HTML_WHITELIST = ['b', 'i', 'u', 's', 'code', 'pre', 'tg-thinking', 'details', 'summary'] as const;

/** Type-safe HTML tag for rich messages */
export type RichMessageTag = typeof RICH_MESSAGE_HTML_WHITELIST[number];

/** Options for sendRichMessage / sendRichMessageDraft */
export interface RichMessageOptions {
  chat_id: number | string;
  text?: string;
  rich_message?: { html: string };
  reply_markup?: InlineKeyboardMarkup;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_sending_without_reply?: boolean;
  /** Ephemeral: visible only to this user (Bot API 10.2+) */
  receiver_user_id?: number;
  /** Ephemeral: visible only to callback query sender (Bot API 10.2+) */
  callback_query_id?: string;
}

/** Parameters for sendRichMessageDraft */
export interface DraftParams {
  chat_id: number | string;
  draft_id: string;
  text?: string;
  rich_message?: { html: string };
  is_final?: boolean;
  reply_to_message_id?: number;
}

// ============================================================================
// Bot API helper types
// ============================================================================

/** Send message parameters */
export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
  disable_notification?: boolean;
  protect_content?: boolean;
  message_thread_id?: number; // for threads
}

/** Edit message text parameters */
export interface EditMessageTextParams {
  chat_id?: number | string;
  message_id?: number;
  inline_message_id?: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: InlineKeyboardMarkup;
}

/** Delete message parameters */
export interface DeleteMessageParams {
  chat_id: number | string;
  message_id: number;
}

/** Send chat action parameters */
export type ChatAction = 
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_audio'
  | 'upload_audio'
  | 'upload_document'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

export interface SendChatActionParams {
  chat_id: number | string;
  action: ChatAction;
  message_thread_id?: number;
}

/** Answer callback query parameters */
export interface AnswerCallbackQueryParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
  url?: string;
  cache_time?: number;
}

/** Set webhook parameters */
export interface SetWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
  drop_pending_updates?: boolean;
}