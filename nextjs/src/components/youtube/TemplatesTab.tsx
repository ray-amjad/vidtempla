/**
 * Templates Tab Component
 * Create and manage templates with {{variables}}
 */

import { useState } from 'react';
import { api } from '@/utils/api';
import type { RouterOutputs } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Spinner } from "@/components/ui/spinner";
import { Plus, Edit, Trash2 } from 'lucide-react';
import UpdateImpactDialog from './UpdateImpactDialog';

type Template = RouterOutputs['dashboard']['youtube']['templates']['list'][number];

export default function TemplatesTab() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({ name: '', content: '' });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Track original content for change detection
  const [originalContent, setOriginalContent] = useState('');

  // Impact dialog state
  const [showImpactDialog, setShowImpactDialog] = useState(false);
  const [impactData, setImpactData] = useState<{
    videoCount: number;
    containers: Array<{ id: string; name: string; videoCount: number }>;
  }>({ videoCount: 0, containers: [] });

  const { data: templates, isLoading, refetch } = api.dashboard.youtube.templates.list.useQuery();
  const createMutation = api.dashboard.youtube.templates.create.useMutation();
  const updateMutation = api.dashboard.youtube.templates.update.useMutation();
  const deleteMutation = api.dashboard.youtube.templates.delete.useMutation();
  const getAffectedVideosMutation = api.dashboard.youtube.templates.getAffectedVideos.useMutation();
  const isSaving = updateMutation.isPending || getAffectedVideosMutation.isPending;

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Error',
        description: 'Template name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createMutation.mutateAsync(formData);
      toast({
        title: 'Template created',
        description: 'Your template has been created successfully.',
      });
      setFormData({ name: '', content: '' });
      setCreateDialogOpen(false);
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create template',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = async () => {
    if (!selectedTemplate) return;

    // If content didn't change, save directly without confirmation
    if (formData.content === originalContent) {
      await performUpdate();
      return;
    }

    // Get affected videos and containers
    try {
      const result = await getAffectedVideosMutation.mutateAsync({
        templateId: selectedTemplate.id,
      });
      setImpactData({
        videoCount: result.count,
        containers: result.containers,
      });
      setShowImpactDialog(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check affected videos',
        variant: 'destructive',
      });
    }
  };

  const performUpdate = async () => {
    if (!selectedTemplate) return;

    try {
      await updateMutation.mutateAsync({
        id: selectedTemplate.id,
        name: formData.name,
        content: formData.content,
      });

      const contentChanged = formData.content !== originalContent;
      toast({
        title: 'Template updated',
        description: contentChanged
          ? `Template updated. ${impactData.videoCount} video${impactData.videoCount !== 1 ? 's' : ''} will be updated in the background.`
          : 'Template has been updated successfully.',
      });

      setEditDialogOpen(false);
      setSelectedTemplate(null);
      setFormData({ name: '', content: '' });
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update template',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync({ id });
      toast({
        title: 'Template deleted',
        description: 'The template has been deleted successfully.',
      });
      refetch();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete template',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const openEditDialog = (template: Template) => {
    setSelectedTemplate(template);
    setFormData({ name: template.name, content: template.content });
    setOriginalContent(template.content);
    setEditDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Templates</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Create templates with {'{{variables}}'} for dynamic content
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              No templates created yet
            </p>
            <Button onClick={() => setCreateDialogOpen(true)} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Template
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    {template.variables && template.variables.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {template.variables.map((v: string) => (
                          <code key={v} className="px-2 py-1 bg-muted rounded text-xs">
                            {'{{' + v + '}}'}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No variables</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(template)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deletingId === template.id}
                          >
                            {deletingId === template.id ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the template and all associated variables.
                              Videos using this template will need to be reassigned.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(template.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Create Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Template Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Product Description"
                />
              </div>
              <div>
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Use {{variable_name}} for dynamic content&#10;&#10;Example:&#10;Check out this product!&#10;Price: {{price}}&#10;Link: {{link}}"
                  rows={10}
                  className="font-mono text-sm"
                />
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Use {'{{variable_name}}'} syntax. Variables will be auto-detected.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Available default variables: <code className="px-1.5 py-0.5 bg-muted rounded">{'{{video-id}}'}</code>
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending && <Spinner className="mr-2 h-4 w-4" />}
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Template Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-content">Content</Label>
                <Textarea
                  id="edit-content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={10}
                  className="font-mono text-sm"
                />
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Use {'{{variable_name}}'} syntax. Variables will be auto-detected.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Available default variables: <code className="px-1.5 py-0.5 bg-muted rounded">{'{{video-id}}'}</code>
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleEdit} disabled={isSaving}>
                  {isSaving && <Spinner className="mr-2 h-4 w-4" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Impact Dialog */}
        <UpdateImpactDialog
          open={showImpactDialog}
          onOpenChange={setShowImpactDialog}
          onConfirm={performUpdate}
          updateType="template"
          videoCount={impactData.videoCount}
          containers={impactData.containers}
        />
      </CardContent>
    </Card>
  );
}
