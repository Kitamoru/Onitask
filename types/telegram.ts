// TelegramWebApp, InitData типы
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