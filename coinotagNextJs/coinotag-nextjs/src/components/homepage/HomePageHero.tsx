import React from 'react';
import Link from 'next/link';
import { ChevronRight, Newspaper, Zap, RadioTower, Lightbulb, Target, ClockFast, Sparkles, TrendingUp, Users, ShieldCheck, Scale, Globe, HelpCircle, MessageSquare, Info } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { timeAgo, formatDate } from "@/lib/utils";
import MiniMarketOverview, { MiniMarketOverviewSkeleton } from "./MiniMarketOverview";
import { BreakingNews } from '@/lib/types';
import { Suspense } from 'react';

interface HomePageHeroProps {
  lang: string;
  breakingNews: BreakingNews[];
}

const HomePageHero: React.FC<HomePageHeroProps> = ({ lang, breakingNews }) => {
  const localizedTitle = lang === 'tr' ? "Kripto Dünyasının Nabzı, Anında Cebinizde" : "The Pulse of Crypto, Instantly in Your Pocket";
  const localizedSubtitle = lang === 'tr' ? 
    "Coinotag ile 2500+ kaynaktan en son kripto para haberlerini, fiyata etki eden gelişmeleri, detaylı analizleri ve canlı piyasa verilerini anlık takip edin."
    : "Follow the latest cryptocurrency news from 2500+ sources, price-affecting developments, detailed analyses, and live market data instantly with Coinotag.";
  const marketButtonText = lang === 'tr' ? "Piyasaları Keşfet" : "Explore Markets";
  const newsButtonText = lang === 'tr' ? "Haberlere Göz At" : "Browse News";

  return (
    <section className="relative bg-gradient-to-br from-primary/10 via-background to-background py-10 md:py-16 lg:py-20 w-full overflow-hidden">
      <div className="absolute inset-0 opacity-5 dark:opacity-[0.03]">
          <Sparkles className="absolute top-1/4 left-1/4 h-64 w-64 text-primary animate-pulse" />
          <Globe className="absolute bottom-1/4 right-1/4 h-48 w-48 text-accent animate-pulse delay-500"/>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 items-center max-w-screen-2xl">
          <div className="space-y-5 md:space-y-6 text-center md:text-left">
            <Badge variant="secondary" className="py-1 px-3 text-xs sm:text-sm">
              <Zap className="h-3.5 w-3.5 mr-1.5" /> {lang === 'tr' ? "En Hızlı Güncellemeler" : "Fastest Updates"}
            </Badge>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
              {localizedTitle}
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto md:mx-0">
              {localizedSubtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start pt-2">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-transform hover:scale-105">
                <Link href={`/${lang}/kripto-paralar`}>{marketButtonText}</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-border hover:bg-muted/50 shadow-sm transition-transform hover:scale-105">
                <Link href={`/${lang}/haberler`}>{newsButtonText}</Link>
              </Button>
            </div>
          </div>
          
          <div className="w-full max-w-md mx-auto md:max-w-none">
            <Suspense fallback={<MiniMarketOverviewSkeleton />}>
                <MiniMarketOverview />
            </Suspense>
          </div>

        </div>

        {breakingNews && breakingNews.length > 0 && (
          <div className="mt-12 md:mt-20 pt-8 md:pt-10 border-t border-border/60">
            <div className="flex justify-between items-center mb-4 md:mb-5">
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground flex items-center">
                <RadioTower className="h-5 w-5 mr-2.5 text-primary" />
                Son Dakika Gelişmeleri
              </h2>
              <Link href={`/${lang}/son-dakika-haberleri/`} className="text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center">
                Tümü <ChevronRight className="h-4 w-4 ml-0.5" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
              {breakingNews.slice(0, 4).map((news) => (
                <Link key={news.id || news.slug} href={`/${lang}/haber/${news.slug}`} className="group block bg-card hover:bg-muted/30 dark:hover:bg-muted/20 p-3.5 sm:p-4 rounded-lg shadow-sm border border-border/60 transition-all duration-200 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    {news.image_url && (
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden flex-shrink-0 border border-border/50 shadow-sm">
                           <Image 
                                src={news.image_url} 
                                alt={news.title} 
                                width={80} 
                                height={80} 
                                className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                                unoptimized={true} 
                            />
                        </div>
                    )}
                    <div className="flex-1">
                      <h3 className="text-sm sm:text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-2 sm:line-clamp-3">
                        {news.title}
                      </h3>
                      <div className="mt-1.5 text-xs text-muted-foreground flex items-center flex-wrap">
                        <span>{timeAgo(news.date, lang)}</span>
                        <span className="mx-1.5">•</span>
                        <span title={formatDate(news.date, lang, true)}>{formatDate(news.date, lang, true, "Europe/Istanbul")}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default HomePageHero;

export function HomePageHeroSkeleton() {
  return (
    <section className="bg-gradient-to-br from-primary/10 via-background to-background py-10 md:py-16 lg:py-20 w-full">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 items-center max-w-screen-2xl">
          <div className="space-y-5 md:space-y-6 text-center md:text-left">
            <div className="inline-block h-7 bg-muted/50 rounded-md w-48 mb-2"></div> 
            <div className="h-10 md:h-12 bg-muted/50 rounded w-full max-w-lg mx-auto md:mx-0"></div> 
            <div className="h-10 md:h-12 bg-muted/50 rounded w-3/4 max-w-md mx-auto md:mx-0"></div> 
            <div className="h-16 bg-muted/40 rounded w-full max-w-lg mx-auto md:mx-0"></div> 
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start pt-2">
              <div className="h-11 bg-muted/60 rounded-md w-36"></div> 
              <div className="h-11 bg-muted/50 rounded-md w-36"></div> 
            </div>
          </div>
          <div className="w-full max-w-md mx-auto md:max-w-none">
             <MiniMarketOverviewSkeleton />
          </div>
        </div>

        <div className="mt-12 md:mt-20 pt-8 md:pt-10 border-t border-border/60">
            <div className="flex justify-between items-center mb-4 md:mb-5">
                <div className="h-7 bg-muted/50 rounded w-1/3"></div>
                <div className="h-5 bg-muted/40 rounded w-16"></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="bg-muted/20 p-3.5 sm:p-4 rounded-lg shadow-sm border border-transparent h-24 flex items-start gap-3">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-muted/40 rounded-md flex-shrink-0"></div>
                        <div className="flex-1 space-y-2 pt-1">
                            <div className="h-4 bg-muted/40 rounded w-full"></div>
                            <div className="h-4 bg-muted/40 rounded w-3/4"></div>
                            <div className="h-3 bg-muted/30 rounded w-1/2 mt-1"></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </section>
  )
} 