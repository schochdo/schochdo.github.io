import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(true),
    summary: z.string(),
    thumbnail: z.string().optional(),
    heroImage: z.string().optional(),
    liveUrl: z.string().optional(),
    githubUrl: z.string().optional(),
    category: z.string().optional(),
    order: z.number().default(99),
  }),
});

export const collections = { projects };
