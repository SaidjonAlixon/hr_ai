import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMeQueryKey, useGetMe, type User } from '@workspace/api-client-react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  setUser: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient();
  /** Login/logout dan kelgan darhol holat; undefined = server javobiga tayanish */
  const [overrideUser, setOverrideUser] = useState<User | null | undefined>(undefined);

  const { data, isPending, isFetching, isError, isSuccess, status } = useGetMe({
    query: {
      retry: (count, err) => {
        const statusCode = (err as { status?: number } | undefined)?.status;
        if (statusCode === 401 || statusCode === 403 || statusCode === 204) return false;
        return count < 1;
      },
      retryDelay: 400,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  // Serverdan kelgan user bilan sync (F5 / yangilash)
  useEffect(() => {
    if (isSuccess && data) {
      setOverrideUser(undefined);
    }
  }, [isSuccess, data]);

  const setUser = useCallback(
    (next: User | null) => {
      setOverrideUser(next);
      if (next) {
        queryClient.setQueryData(getGetMeQueryKey(), next);
      } else {
        queryClient.setQueryData(getGetMeQueryKey(), undefined);
      }
    },
    [queryClient],
  );

  const user = useMemo(() => {
    if (overrideUser !== undefined) return overrideUser;
    if (isSuccess && data) return data;
    if (isError) return null;
    return null;
  }, [overrideUser, isSuccess, data, isError]);

  // Hali /auth/me kutilmoqda yoki muvaffaqiyatli javob bor, lekin user hali bog'lanmagan
  const isLoading =
    overrideUser === undefined &&
    (isPending || status === 'pending' || (isFetching && !data && !isError));

  const isAuthenticated = !!user;

  const value = useMemo(
    () => ({ user, isLoading, isAuthenticated, setUser }),
    [user, isLoading, isAuthenticated, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
