import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/features/auth/AuthProvider';

export function HomeView() {
  const [tecnicoId, setTecnicoId] = useState('');
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // Desde Sprint 9 un tecnico solo puede ver SU agenda (403 si pide otra),
  // asi que para el no tiene sentido el buscador por id: se le ofrece un
  // acceso directo. El admin si necesita elegir tecnico.
  const esTecnico = usuario?.rol === 'tecnico';
  const esAdmin = usuario?.rol === 'admin';

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>turnos-platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {esTecnico && (
            <Button
              className="w-full"
              onClick={() => navigate(`/agenda/${usuario.id}`)}
            >
              Ver mi agenda de hoy
            </Button>
          )}

          {esAdmin && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Ingresa el id de un tecnico para ver su agenda del dia.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="uuid del tecnico"
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
              />
              <Button
                disabled={!tecnicoId}
                onClick={() => navigate(`/agenda/${tecnicoId}`)}
              >
                Ver agenda
              </Button>
            </div>
          </div>
          )}

          {esAdmin && <Separator />}

          {esAdmin && (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => navigate('/dashboard')}
              >
                Dashboard de indicadores
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate('/admin')}
              >
                Panel administrativo
              </Button>
              <Button
                variant="link"
                className="w-full"
                onClick={() => navigate('/design')}
              >
                Sistema de diseno
              </Button>
            </div>
          )}

          {!esAdmin && !esTecnico && (
            <p className="text-sm text-muted-foreground">
              Tu usuario no tiene acceso a ninguna vista de este panel.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
