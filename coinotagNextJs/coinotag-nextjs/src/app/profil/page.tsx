"use client";

import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, UploadCloud, UserCircle, Star, Bell, AlertTriangle, TrendingUp } from "lucide-react";
import Link from "next/link";

// Define the Profile type
interface Profile {
  id: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  updated_at?: string | null;
  subscription_tier?: string | null;
}

export default function ProfilePage() {
  const supabaseClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session: currentSession }, error: sessionError } =
        await supabaseClient.auth.getSession();

      if (sessionError) {
        console.error("Error fetching session:", sessionError);
        toast.error("Oturum bilgileri alınırken bir hata oluştu.");
        setError("Oturum bilgileri alınamadı.");
        setLoading(false);
        return;
      }
      setSession(currentSession);
    };
    getSession();

    const { data: authListener } = supabaseClient.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [supabaseClient.auth]);

  const fetchUserProfile = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabaseClient
        .from("profiles")
        .select("id, username, full_name, avatar_url, subscription_tier")
        .eq("id", session.user.id)
        .single();

      if (fetchError) {
        console.error("Error fetching profile (Supabase):", JSON.stringify(fetchError, null, 2), fetchError);
        
        if (fetchError.code === "PGRST116") {
          // Profil bulunamadı, otomatik oluştur
          console.log("Profile not found for user, creating automatically...");
          
          try {
            const newProfile = {
              id: session.user.id,
              username: session.user.email?.split('@')[0] + '_' + Math.floor(Math.random() * 1000),
              full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
              avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
              subscription_tier: 'FREE'
            };

            const { data: newProfileData, error: createError } = await supabaseClient
              .from("profiles")
              .insert(newProfile)
              .select()
              .single();

            if (createError) {
              console.error("Error creating profile:", createError);
              toast.error("Profil oluşturulamadı. Lütfen daha sonra tekrar deneyin.");
              setError(`Profile Creation Error: ${createError.message}`);
            } else if (newProfileData) {
              console.log("Profile created successfully:", newProfileData);
              setProfile(newProfileData);
              setUsername(newProfileData.username || "");
              setFullName(newProfileData.full_name || "");
              setAvatarUrl(newProfileData.avatar_url || "");
              toast.success("Profil otomatik olarak oluşturuldu!");
            }
          } catch (createErr: any) {
            console.error("Unexpected error creating profile:", createErr);
            toast.error("Profil oluşturulurken beklenmedik bir hata oluştu.");
            setError(`Profile Creation Error: ${createErr.message}`);
          }
        } else {
          // Diğer Supabase hataları
          toast.error("Profil bilgileri alınamadı. Lütfen daha sonra tekrar deneyin.");
          setError(`Supabase Error: ${fetchError.message} (Code: ${fetchError.code})`);
        }
        setLoading(false);
        return;
      }

      if (data) {
        setProfile(data);
        setUsername(data.username || "");
        setFullName(data.full_name || "");
        setAvatarUrl(data.avatar_url || "");
      } else if (!fetchError) {
        console.warn("Profile data is null but no Supabase error was reported.");
      }

    } catch (e: any) {
      setLoading(false);
      console.error("Unexpected client-side error in fetchUserProfile:", e);
      if (e && typeof e.message === 'string') {
        toast.error(`Profil alınırken bir istemci hatası oluştu: ${e.message}`);
        setError(`Client Error: ${e.message}`);
      } else {
        toast.error("Profil bilgileri alınırken bilinmeyen bir istemci hatası oluştu.");
        setError("Bilinmeyen bir istemci hatası.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, supabaseClient]);

  useEffect(() => {
    if (session) {
      fetchUserProfile();
    }
  }, [session, fetchUserProfile]);

  const deleteOldAvatar = async (oldAvatarPath: string | null | undefined) => {
    if (!oldAvatarPath) return;
    try {
      const fileName = oldAvatarPath.split("/").pop();
      if (!fileName) return;
      const { error: deleteError } = await supabaseClient.storage
        .from("avatars")
        .remove([fileName]);
      if (deleteError) {
        console.error("Error deleting old avatar:", deleteError);
        // Eski avatar silinemezse bile devam et, sadece logla
      }
    } catch (e) {
      console.error("Unexpected error deleting old avatar:", e);
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      toast.error("Avatar dosyası 2MB'den büyük olamaz.");
      return;
    }

    setAvatarFile(file);
    setUploadingAvatar(true);
    setError(null);

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${session?.user?.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Önce eski avatarı sil (varsa)
      if (profile?.avatar_url) {
        await deleteOldAvatar(profile.avatar_url);
      }

      const { error: uploadError } = await supabaseClient.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error("Error uploading avatar:", uploadError);
        toast.error("Avatar yüklenirken bir hata oluştu.");
        setError(uploadError.message);
        setUploadingAvatar(false);
        return;
      }

      const { data: publicUrlData } = supabaseClient.storage
        .from("avatars")
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        toast.error("Avatar URL'si alınamadı.");
        setError("Avatar URL'si alınamadı.");
        setUploadingAvatar(false);
        return;
      }
      
      setAvatarUrl(publicUrlData.publicUrl); // State'i güncelle
      // Hemen profili de güncelle
      const { error: updateError } = await supabaseClient
        .from("profiles")
        .update({ avatar_url: publicUrlData.publicUrl, updated_at: new Date().toISOString() })
        .eq("id", session!.user.id);

      if (updateError) {
        console.error("Error updating profile with new avatar_url:", updateError);
        toast.error("Profil avatarı güncellenirken hata oluştu.");
        setError(updateError.message);
      } else {
        toast.success("Avatar başarıyla yüklendi ve profil güncellendi!");
        setProfile(prev => prev ? { ...prev, avatar_url: publicUrlData.publicUrl } : null);
      }

    } catch (e: any) {
      console.error("Unexpected error uploading avatar:", e);
      toast.error("Avatar yüklenirken beklenmedik bir hata oluştu.");
      setError("Beklenmedik bir hata oluştu.");
    } finally {
      setUploadingAvatar(false);
      setAvatarFile(null); // Dosyayı temizle
    }
  };

  const handleProfileUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user?.id) {
      toast.error("Kullanıcı oturumu bulunamadı.");
      return;
    }

    setLoading(true);
    setError(null);

    const updates: Partial<Profile> & { id: string, updated_at: string } = {
      id: session.user.id,
      username,
      full_name: fullName,
      // avatar_url avatar yükleme ile ayrı yönetiliyor, ama burada da güncellenebilir
      // eğer direkt URL girilmesine izin verilmiyorsa bu satır olmamalı.
      // Şimdilik handleAvatarUpload içinde güncellendiği için burada tekrar etmiyoruz.
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error: updateError } = await supabaseClient
        .from("profiles")
        .upsert(updates) // upsert kullanmak, profil yoksa oluşturur (trigger olsa da bir güvence)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating profile:", updateError);
        toast.error(updateError.message || "Profil güncellenemedi.");
        setError(updateError.message || "Bilinmeyen bir hata oluştu.");
      } else if (data) {
        setProfile(data); // Güncel profili state'e al
        toast.success("Profil başarıyla güncellendi!");
      }
    } catch (e: any) {
      console.error("Unexpected error updating profile:", e);
      toast.error("Profil güncellenirken beklenmedik bir hata oluştu.");
      setError("Beklenmedik bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };


  if (loading && !profile && !session) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <UserCircle className="h-4 w-4" />
          <AlertTitle>Erişim Reddedildi</AlertTitle>
          <AlertDescription>
            Profil sayfasını görüntülemek için lütfen giriş yapın.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Profil Ayarları</CardTitle>
          <CardDescription>
            Kişisel bilgilerinizi ve tercihlerinizi buradan yönetebilirsiniz.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleProfileUpdate}>
          <CardContent className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Bir Hata Oluştu</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="avatar">Avatar</Label>
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={avatarUrl || undefined} alt={username || "Kullanıcı"} />
                  <AvatarFallback>
                    {fullName ? fullName.charAt(0).toUpperCase() : username ? username.charAt(0).toUpperCase() : <UserCircle />}
                  </AvatarFallback>
                </Avatar>
                <Input
                  id="avatar"
                  type="file"
                  accept="image/png, image/jpeg, image/gif"
                  onChange={handleAvatarUpload}
                  disabled={uploadingAvatar}
                  className="max-w-xs"
                />
                {uploadingAvatar && <Loader2 className="h-5 w-5 animate-spin" />}
              </div>
               {avatarFile && <p className="text-sm text-muted-foreground">Seçilen dosya: {avatarFile.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" value={session.user.email || ""} disabled />
              <p className="text-sm text-muted-foreground">
                E-posta adresiniz değiştirilemez.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Kullanıcı Adı</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Orn: kripto_kurdu"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName">Tam Adınız</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Orn: Ali Veli"
              />
            </div>
             {/* Abonelik Bilgisi (Örnek) */}
            {profile?.subscription_tier && (
              <div className="space-y-2">
                <Label>Abonelik Seviyesi</Label>
                <div className="flex items-center justify-between">
                  <Input value={profile.subscription_tier.toUpperCase()} disabled />
                  {profile.subscription_tier === 'FREE' && (
                    <Link href="/pricing" className="ml-2">
                      <Button variant="outline" size="sm">
                        <Star className="mr-1 h-4 w-4" /> Premium'a Yükselt
                      </Button>
                    </Link>
                  )}
                </div>
                {profile.subscription_tier === 'FREE' && (
                  <p className="text-sm text-muted-foreground">
                    Premium özelliklere erişim için planınızı yükseltin.
                  </p>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loading || uploadingAvatar}>
              {(loading || uploadingAvatar) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Bilgileri Güncelle
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Alarmlar ve Bildirimler */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Alarmlar Kartı */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Alarmlarım
            </CardTitle>
            <CardDescription>
              Aktif fiyat ve teknik alarmlarınız
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center text-muted-foreground py-4">
              Henüz alarm oluşturmadınız
            </div>
            <Link href="/kripto-paralar">
              <Button variant="outline" className="w-full">
                Alarm Oluştur
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Bildirimler Kartı */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Bildirimler
            </CardTitle>
            <CardDescription>
              Son bildirimler ve haberler
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center text-muted-foreground py-4">
              Yeni bildirim yok
            </div>
            <Button variant="outline" className="w-full">
              Tüm Bildirimleri Gör
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Aktivite Özeti */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Aktivite Özeti
          </CardTitle>
          <CardDescription>
            Son 30 günlük platformdaki aktiviteniz
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-muted-foreground">Aktif Alarm</div>
            </div>
            <div>
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-muted-foreground">Okunan Blog</div>
            </div>
            <div>
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-muted-foreground">Takip Edilen Coin</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{profile?.subscription_tier === 'PRO_PLUS' ? 'PRO+' : profile?.subscription_tier || 'FREE'}</div>
              <div className="text-sm text-muted-foreground">Üyelik Seviyesi</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 