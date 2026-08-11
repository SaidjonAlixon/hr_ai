import React, { useState } from 'react';
import { useLogin } from '@workspace/api-client-react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'wouter';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '../components/ui/card';
import { useToast } from '../hooks/use-toast';

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const { mutate, isPending } = useLogin();
  const { setUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!login || !password) return;

    mutate({ data: { login, password } }, {
      onSuccess: (data) => {
        setUser(data.user);
        setLocation(data.user.role === 'farmasevt' ? '/kirish' : '/dashboard');
      },
      onError: () => {
        toast({
          title: 'Xatolik',
          description: 'Login yoki parol noto\'g\'ri',
          variant: 'destructive',
        });
      }
    });
  };

  const demoAccounts = [
    { label: "Admin", login: "admin", pass: "admin123" },
    { label: "Rekruter", login: "recruiter1", pass: "pass123" },
    { label: "HR", login: "hr1", pass: "pass123" },
    { label: "Trener", login: "trainer1", pass: "pass123" },
    { label: "Direktor", login: "director1", pass: "pass123" },
    { label: "Bo'lim boshlig'i", login: "dept_head1", pass: "pass123" },
    { label: "Mudir", login: "mudir1", pass: "pass123" },
    { label: "Koordinator", login: "koordinator1", pass: "pass123" },
    { label: "Farmasevt", login: "farmasevt1", pass: "pass123" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}vaksinahr_logo1.png?v=11`}
            alt="VAKSINA HR — Kadrlarni boshqaruv dasturi"
            className="mx-auto h-36 w-auto max-w-full object-contain sm:h-44"
          />
        </div>

        <Card className="border-t-4 border-t-primary shadow-xl">
          <CardHeader>
            <CardTitle>Tizimga kirish</CardTitle>
            <CardDescription>
              O'z profilingizga kirish uchun ma'lumotlarni kiriting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login">Login</Label>
                <Input 
                  id="login" 
                  value={login} 
                  onChange={(e) => setLogin(e.target.value)} 
                  placeholder="Loginni kiriting"
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Parol</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Parolni kiriting"
                  required 
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Kirilmoqda...' : 'Kirish'}
              </Button>
            </form>
          </CardContent>
          
          <CardFooter className="flex flex-col items-stretch pt-0 border-t mt-6 bg-gray-50/50">
            <div className="text-sm font-medium text-center text-gray-500 py-4">
              Demo akkauntlar (tanlang):
            </div>
            <div className="grid grid-cols-2 gap-2 pb-4">
              {demoAccounts.map((acc) => (
                <Button 
                  key={acc.login} 
                  variant="outline" 
                  size="sm"
                  className="justify-start text-xs h-8"
                  onClick={() => {
                    setLogin(acc.login);
                    setPassword(acc.pass);
                    setTimeout(() => {
                      mutate({ data: { login: acc.login, password: acc.pass } }, {
                        onSuccess: (data) => {
                          setUser(data.user);
                          setLocation('/dashboard');
                        }
                      });
                    }, 100);
                  }}
                >
                  {acc.label}
                </Button>
              ))}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
