import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '../ui';
import { useSession } from '../../hooks/useApp';
import { lessonsRepo } from '../../db/repositories';
import { useToast } from '../ui/feedback';
import type { Lesson } from '../../types/models';

export function LessonModal({ open, onClose, date, lesson, nextNumber = 1 }: { open: boolean; onClose: () => void; date: string; lesson?: Lesson | null; nextNumber?: number }) {
  const { user, student, visibleSubjects } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ date, number: nextNumber, subjectId: '', topic: '' });
  useEffect(() => {
    if (open) setForm(lesson ? { date: lesson.date, number: lesson.number, subjectId: lesson.subjectId, topic: lesson.topic } : { date, number: nextNumber, subjectId: visibleSubjects[0]?.id ?? '', topic: '' });
  }, [open, lesson, date, nextNumber, visibleSubjects]);
  const save = async () => {
    if (!student || !form.subjectId) return;
    try {
      await lessonsRepo.save(user.id, { id: lesson?.id, studentId: student.id, date: form.date, number: Number(form.number) || 1, subjectId: form.subjectId, topic: form.topic.trim(), isDemo: student.isDemo });
      toast(lesson ? 'Урок оновлено' : 'Урок додано до розкладу');
      onClose();
    } catch (e) {
      toast('Помилка збереження: ' + (e as Error).message, 'error');
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={lesson ? 'Редагувати урок' : 'Додати урок'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Скасувати</Button><Button onClick={save} disabled={!form.subjectId}>Зберегти</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Дата" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input label="Номер уроку" type="number" min={1} max={12} value={form.number} onChange={(e) => setForm({ ...form, number: Number(e.target.value) })} />
        <Select label="Предмет" className="col-span-2" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
          {visibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input label="Тема" className="col-span-2" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Необов'язково" />
      </div>
    </Modal>
  );
}
