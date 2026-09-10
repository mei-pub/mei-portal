// service/favorite —— Go internal/service/favorite.go 的复刻

import type { Favorite, FavoriteRepository } from '../db.ts';

export class URLAlreadyExistsError extends Error {
  constructor() {
    super('url_already_exists');
    this.name = 'URLAlreadyExistsError';
  }
}

export interface AddFavoriteInput {
  title: string;
  url: string;
  icon: string | null;
}

export class FavoriteService {
  private readonly repo: FavoriteRepository;
  constructor(repo: FavoriteRepository) {
    this.repo = repo;
  }

  getFavorites(): Favorite[] {
    return this.repo.findAll('DESC');
  }

  addFavorite(input: AddFavoriteInput): Favorite {
    if (this.repo.findByURL(input.url)) throw new URLAlreadyExistsError();
    return this.repo.create(input);
  }

  removeFavorite(id: number): void {
    this.repo.delete(id);
  }

  exportFavorites(): string {
    const favs = this.repo.findAll('DESC');
    const items = favs.map((f) => {
      const item: { title: string; url: string; icon?: string } = { title: f.title, url: f.url };
      if (f.icon !== null && f.icon !== undefined) item.icon = f.icon;
      return item;
    });
    return JSON.stringify(items, null, 2);
  }

  importFavorites(inputs: AddFavoriteInput[]): void {
    if (inputs.length === 0) return;
    this.repo.createMany(inputs);
  }
}
