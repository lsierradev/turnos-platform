import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

export function HomeView() {
  const [tecnicoId, setTecnicoId] = useState('');
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>turnos-platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <Separator />

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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
