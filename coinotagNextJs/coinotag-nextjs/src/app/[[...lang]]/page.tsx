import { Suspense } from "react";
import { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { wordpressAPI } from "@/lib/api";
import { HomePageData } from "@/lib/types";
import { Head } from "next/head";
import Script from "next/script";

import HomePageHero from "@/components/homepage/HomePageHero";
import HomePageContent from "@/components/homepage/HomePageContent";
import CombinedMarketSection from "@/components/homepage/CombinedMarketSection";
import WhyCoinotag from "@/components/homepage/WhyCoinotag";
import Footer from "@/components/layout/Footer";
import SocialFollowSection from "@/components/homepage/SocialFollowSection";

// Basit Skeleton Tanımlamaları
const HomePageHeroSkeleton = () => <div className="w-full h-[70vh] bg-gradient-to-br from-primary/10 via-background to-background animate-pulse"></div>;
const HomePageContentSkeleton = () => (
  <div className="px-4 md:px-6 lg:px-8 max-w-screen-2xl mx-auto py-8">
    <div className="h-8 bg-muted rounded w-1/3 mb-6 animate-pulse"></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-card p-4 rounded-lg shadow-md border h-72 animate-pulse"></div>
      ))}
    </div>
  </div>
);

export const revalidate = 60;

type Props = {
  params: {
    lang?: string[];
  };
};

async function getHomePageServerData(lang: string): Promise<HomePageData> {
  const getCachedData = unstable_cache(
    async (locale: string) => {
      return wordpressAPI.getHomePageData(locale);
    },
    ["homePageData"],
    {
      tags: ["homePageData"],
      revalidate: revalidate,
    }
  );
  return getCachedData(lang);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params;
  let lang = "tr";
  if (resolvedParams.lang && Array.isArray(resolvedParams.lang) && resolvedParams.lang.length > 0) {
    lang = resolvedParams.lang[0];
  } else if (typeof resolvedParams.lang === 'string') {
    lang = resolvedParams.lang;
  }

  const siteName = "Coinotag";
  const title = lang === "tr" ? `${siteName}: Kripto Para Haberleri, Analizler ve Piyasa Verileri` : `${siteName}: Crypto News, Analysis, and Market Data`;
  const description = lang === "tr" ? "Coinotag ile en güncel kripto para haberlerini, derinlemesine piyasa analizlerini ve anlık Bitcoin, Ethereum fiyatlarını takip edin. Kripto dünyasına dair her şey!" : "Stay updated with the latest cryptocurrency news, in-depth market analysis, and live Bitcoin, Ethereum prices with Coinotag. Everything about the crypto world!";
  
  const localeSubdomain = lang === "tr" ? "" : `${lang}.`;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://coinotag.com";
  const canonicalUrl = `https://${localeSubdomain}${baseUrl.replace(/^https?:\/\//, '')}`;

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Coinotag",
    "url": canonicalUrl,
    "logo": `${baseUrl}/assets/img/logo/coinotag_logo.png`,
    "sameAs": [
      "https://twitter.com/coinotag",
      "https://www.facebook.com/coinotag",
      "https://www.linkedin.com/company/coinotag",
      "https://www.instagram.com/coinotag",
      "https://www.youtube.com/coinotag"
    ]
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Coinotag",
    "url": canonicalUrl,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${canonicalUrl}/arama?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: `%s | ${siteName}`,
    },
    description: description,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'tr-TR': `${baseUrl}`,
        'en-US': `https://en.${baseUrl.replace(/^https?:\/\//, '')}`,
      },
    },
    openGraph: {
      title: title,
      description: description,
      url: canonicalUrl,
      siteName: siteName,
      images: [
        {
          url: `${baseUrl}/og/home-${lang}.png`,
          width: 1200,
          height: 630,
          alt: `${siteName} Ana Sayfa`,
        },
      ],
      locale: lang === "tr" ? "tr_TR" : "en_US",
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: title,
      description: description,
      images: [`${baseUrl}/og/home-${lang}.png`],
    },
    other: {
      'script[type="application/ld+json"]#organization-schema': JSON.stringify(organizationSchema),
      'script[type="application/ld+json"]#website-schema': JSON.stringify(websiteSchema),
    },
  };
}

export default async function LangRootPage({ params }: Props) {
  const resolvedParams = await params;
  let lang = "tr";
  if (resolvedParams.lang && Array.isArray(resolvedParams.lang) && resolvedParams.lang.length > 0) {
    lang = resolvedParams.lang[0];
  } else if (typeof resolvedParams.lang === 'string') {
    lang = resolvedParams.lang;
  }
  const homePageData: HomePageData = await getHomePageServerData(lang);

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-grow">
        <Suspense fallback={<HomePageHeroSkeleton />}>
          {/* @ts-expect-error Server Component */}
          <HomePageHero lang={lang} breakingNews={homePageData.breakingNews} />
        </Suspense>

        <div className="container mx-auto px-0 sm:px-4 py-6 sm:py-10 space-y-10 sm:space-y-16 max-w-screen-2xl">
          <WhyCoinotag />

          <Suspense fallback={<div className="w-full h-96 bg-muted rounded-lg animate-pulse"></div>}>
            {/* @ts-expect-error Server Component */}
            <CombinedMarketSection />
          </Suspense>

          <Suspense fallback={<HomePageContentSkeleton />}>
            {/* @ts-expect-error Server Component */}
            <HomePageContent lang={lang} recentPosts={homePageData.recentPosts} />
          </Suspense>

          <div className="max-w-3xl mx-auto w-full px-4 sm:px-0 mb-12 md:mb-16">
            <SocialFollowSection />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
} 