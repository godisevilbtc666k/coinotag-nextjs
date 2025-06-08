// CoinGecko API'sinden (/coins/{id}) gelen yanıta benzeyen temel yapı
// İhtiyaç duyulan alanları ekleyebiliriz.
export interface CoinGeckoCoinDetail {
  id: string;
  symbol: string;
  name: string;
  description?: { en?: string; tr?: string; }; // Türkçe açıklama varsa onu da alabiliriz
  links?: {
    homepage?: string[];
    blockchain_site?: string[];
    official_forum_url?: string[];
    chat_url?: string[];
    announcement_url?: string[];
    twitter_screen_name?: string;
    facebook_username?: string;
    subreddit_url?: string;
    repos_url?: {
      github?: string[];
      bitbucket?: string[];
    };
  };
  image?: {
    thumb?: string;
    small?: string;
    large?: string;
  };
  market_cap_rank?: number;
  market_data?: {
    current_price?: { [currency: string]: number };
    market_cap?: { [currency: string]: number };
    total_volume?: { [currency: string]: number };
    high_24h?: { [currency: string]: number };
    low_24h?: { [currency: string]: number };
    price_change_percentage_24h?: number;
    price_change_percentage_7d?: number;
    price_change_percentage_14d?: number;
    price_change_percentage_30d?: number;
    price_change_percentage_60d?: number;
    price_change_percentage_200d?: number;
    price_change_percentage_1y?: number;
    total_supply?: number;
    max_supply?: number | null;
    circulating_supply?: number;
    last_updated?: string; // ISO 8601 formatında
  };
  // Eklenebilecek diğer alanlar...
}

// Sembol -> CoinGecko ID eşleştirmesi için tip
export type SymbolToCoinGeckoIdMap = {
  [symbol: string]: string | undefined;
};

// CoinGecko /coins/markets endpoint yanıtındaki bir eleman
export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  image: string; // URL
  current_price: number;
  market_cap: number;
  market_cap_rank: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
  ath: number;
  ath_change_percentage: number;
  ath_date: string; // ISO 8601
  atl: number;
  atl_change_percentage: number;
  atl_date: string; // ISO 8601
  roi: { times: number; currency: string; percentage: number } | null;
  last_updated: string; // ISO 8601
  categories?: string[];
} 